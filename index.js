const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId, Admin } = require('mongodb');
require('dotenv').config();
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const app = express();
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE_SECRET);

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send("Doctor portal server is running")
});


const uri = `mongodb+srv://${process.env.DOCTOR_USER}:${process.env.DOCTOR_PASS}@cluster0.r7d25w3.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

const sendBookedMail = (booking) => {

    const {email, treatment, appointmentDate, slot} = booking;

    let transporter = nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        auth: {
            user: "apikey",
            pass: process.env.NODE_MAIL_API_KEY
        }
    })

    transporter.sendMail({
        from: "ojitdebnathfreelancer@gmail.com",
        to: email,
        subject: `You have booked for ${treatment}`,
        html: `
            <h2>Congratulations, your appoinment is confirm</h2>
            <div>
                <p>Your appoinment for ${treatment} ${appointmentDate} at ${slot}</p>
                <p>Please visit us on time</p>
                <h5>Thanks from Helth Care</h5>
            </div>
        `,
    }, function (error, info) {
        if (error) {
            console.log(error);
        }
    });

};
// booked mail send to consumer 

const jwtVerify = (req, res, next) => {
    const Ptoken = req.headers.authorization;
    if (!Ptoken) {
        return res.status(401).send({ message: "You not a vaild user" })
    };
    const MToken = Ptoken.split(' ')[1];
    jwt.verify(MToken, process.env.ACCESS_TOKEN, (error, decoded) => {
        if (error) {
            return res.status(403).send({ message: "youre access forbiden", status: 0 })
        }
        req.decoded = decoded;
        next();
    })
};
// jwt token verifying 

const doctor = async () => {
    try {
        const servicesData = client.db('doctorDb').collection('services');
        const bookingData = client.db('doctorDb').collection('booked');
        const usersData = client.db('doctorDb').collection('users');
        const doctorsData = client.db('doctorDb').collection('doctors');
        const paymentsData = client.db('doctorDb').collection('payments');

        const adminVerify = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersData.findOne(query);

            if (user?.role !== 'admin') {
                return res.status(401).send("You are not admin")
            }
            next();
        };

        app.get('/services', async (req, res) => {

            const date = req.query.date;
            const services = await servicesData.find({}).toArray();

            const bookingQuery = { appointmentDate: date };
            const alredayBooked = await bookingData.find(bookingQuery).toArray();

            services.forEach(servics => {
                const servicsBooked = alredayBooked.filter(book => book.treatment === servics.name);

                const bookedSlots = servicsBooked.map(book => book.slot);

                const reamingSlots = servics.slots.filter(slot => !bookedSlots.includes(slot));

                servics.slots = reamingSlots;
            })
            res.send(services);
        });
        // doctors all services 

        app.get('/servicesSpeciality', jwtVerify, async (req, res) => {
            const result = await servicesData.find({}).project({ name: 1 }).toArray();
            res.send(result);
        });
        // get spcial services name 

        app.post('/bookings', jwtVerify, async (req, res) => {

            const booking = req.body;
            const email = req.query.email;

            const query = { treatment: booking.treatment, appointmentDate: booking.appointmentDate, email: email };

            const alredayBooked = await bookingData.find(query).toArray();

            if (alredayBooked.length) {
                const message = `You already have a booking on ${booking.treatment} for ${booking.appointmentDate}`;
                return res.send({ acknowledged: false, message });
            }

            const booked = await bookingData.insertOne(booking);
            sendBookedMail(booking);
            res.send(booked);
        });
        // post booking treatment 

        app.get('/bookings/:id', jwtVerify, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await bookingData.findOne(query);
            res.send(result)
        });
        // get bookings for payment 

        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await usersData.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1d' });
                return res.send({ token })
            }
            res.status(401).send({ message: "your email not found" })
        });
        // jwt token sign 

        app.get('/bookings', jwtVerify, async (req, res) => {
            const decoded = req.decoded;
            const email = req.query.email;
            const date = req.query.date;

            if (decoded.email !== req.query.email) {
                return res.status(403).send({ message: "Your access forbiden", status: 0 })
            }

            let query = { email: email };

            if (date) {
                query.appointmentDate = date
            }

            const bookings = await bookingData.find(query).toArray();
            res.send(bookings);
        })
        // get user all booking 

        app.delete('/bookdelete/:id', jwtVerify, async (req, res) => {
            const email = req.query.email;
            const id = req.params.id;
            const query = { _id: ObjectId(id), email: email };
            const result = await bookingData.deleteOne(query);
            res.send(result);
        })
        // delete book

        app.delete('/bookalldelete', jwtVerify, async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const result = await bookingData.deleteMany(query);
            res.send(result);
        })
        // delete book all delete

        app.post('/users', async (req, res) => {
            const user = req.body;
            const userEmail = user.email;
            const query = { email: userEmail };
            const existUser = await usersData.findOne(query);

            if (existUser) {
                return;
            };

            const result = await usersData.insertOne(user);
            res.send(result);
        });
        // save user to database 

        app.delete('/users/:id', jwtVerify, adminVerify, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await usersData.deleteOne(query);
            res.send(result);
        });
        // delete user from database 

        app.delete('/useralldelete', jwtVerify, adminVerify, async (req, res) => {
            const query = { role: { $ne: 'admin' } };
            const result = await usersData.deleteMany(query);
            res.send(result);
        });
        // delete all user from database 

        app.get('/allusers', jwtVerify, adminVerify, async (req, res) => {
            const users = await usersData.find({}).toArray();
            res.send(users);
        });
        // get all users from db 

        app.put('/users/admin/:id', jwtVerify, adminVerify, async (req, res) => {

            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            };
            const result = await usersData.updateOne(filter, updateDoc, options);
            res.send(result);
        });
        // make admin a usre 

        app.get('/users/admin/:email', jwtVerify, async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const user = await usersData.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' });
        })
        // verify a user admin or nto 

        app.post('/doctors', jwtVerify, adminVerify, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsData.insertOne(doctor);
            res.send(result);
        });
        // save a new doctor to db 

        app.get('/doctors', jwtVerify, adminVerify, async (req, res) => {
            const result = await doctorsData.find({}).toArray();
            res.send(result);
        })
        // get all doctorsData 

        app.delete('/doctors/:id', jwtVerify, adminVerify, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await doctorsData.deleteOne(query);
            res.send(result);
        });
        // delete doctor

        app.delete('/alldeletedoctors', jwtVerify, adminVerify, async (req, res) => {
            const result = await doctorsData.deleteMany({});
            res.send(result);
        });
        // delete all doctors

        app.post('/create-payment-intent', jwtVerify, async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                ],
            })

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });
        // payment for users 

        app.post('/payments', jwtVerify, async (req, res) => {
            const payment = req.body;
            const result = await paymentsData.insertOne(payment);
            const id = payment.bookingId;
            const filter = { _id: ObjectId(id) };
            const updateDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            };
            const updateBooking = await bookingData.updateOne(filter, updateDoc);
            res.send(result);
        })
        // user payment info save to db 

    }
    finally {

    }
};
doctor().catch(error => console.error(error))


app.listen(port, () => {
    console.log("server running", port);
});