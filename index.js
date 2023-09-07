const express = require('express');
const app = express();
const cors = require('cors');
const port = process.env.PORT || 5000;
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const nodemailer = require("nodemailer");

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.kfxi2vn.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// jwt 
const verifyJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'UnAuthorized Access' })
    }

    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' });
        }
        req.decoded = decoded;
        next();
    });
}

// send payment confirmation email 
let transporter = nodemailer.createTransport({
    host: 'smtp.sendgrid.net',
    port: 587,
    auth: {
        user: "apikey",
        pass: process.env.SENDGRID_API_KEY
    }
})
const sendPaymentConfirmationEmail = payment => {
    const { email, name, transactionId } = payment;
    transporter.sendMail({
        from: "alamin931761@gmail.com",
        to: email,
        subject: "Your order is confirmed.",
        text: "Payment Confirmed",
        html: `<div>
        <h2>Hello, ${name},
        <h3>Your order has been confirmed</h3>
        <p>Your Transaction ID is <b>${transactionId}</b></p>

        <p>Our Address</p>
        <p>Gazipur, Bangladesh</p>
        <div>`,
    }, function (error, info) {
        if (error) {
            console.log(error);
        } else {
            console.log('Email sent: ', info.response);
        }
    });

}

async function run() {
    try {
        await client.connect();
        const packageCollection = client.db('the-memory-maker').collection("package");
        const userCollection = client.db('the-memory-maker').collection("user");
        const reviewCollection = client.db('the-memory-maker').collection("review");
        const printCollection = client.db('the-memory-maker').collection("print");
        const temporaryDataCollection = client.db('the-memory-maker').collection("temporary-data");
        const orderCollection = client.db('the-memory-maker').collection("order");

        // verify owner
        const verifyOwner = (req, res, next) => {
            const requester = req.decoded.email;
            console.log('requester--> ', requester);
            if (requester === 'alamin931761@gmail.com') {
                next();
            } else {
                res.status(403).send({ message: 'forbidden access' });
            }
        }

        // create and update user 
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ result, token });
        });

        // update profile 
        app.patch('/user/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const profileInfo = req.body;
            const filter = { email: email };
            const updateDoc = {
                $set: profileInfo
            }
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // load user profile data 
        app.get('/user/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const result = await userCollection.find(query).toArray();
            res.send(result);
        });

        // add review 
        app.post('/addReview', verifyJWT, async (req, res) => {
            const review = req.body;
            const result = await reviewCollection.insertOne(review);
            res.send(result);
        });

        // load reviews 
        app.get('/reviews', async (req, res) => {
            const query = {};
            const result = await reviewCollection.find(query).toArray();
            res.send(result);
        });

        // load services data 
        app.get('/packages', async (req, res) => {
            const query = {};
            const result = await packageCollection.find(query).toArray();
            res.send(result);
        });

        // load prints data 
        app.get('/prints', async (req, res) => {
            const query = {};
            const prints = await printCollection.find(query).toArray();
            res.send(prints);
        });

        // load specified print data
        app.get('/printDetails/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await printCollection.findOne(query);
            res.send(result);
        });

        // create and update temporary cart data 
        app.put('/temporaryData/:email', async (req, res) => {
            const email = req.params.email;
            const order = req.body;
            const name = req.headers.name;
            const price = req.headers.price;
            const filter = { email: email, name: name, price: price };
            const options = { upsert: true };
            const updateDoc = {
                $set: order
            };
            const result = await temporaryDataCollection.updateOne(filter, updateDoc, options);
            res.send(result);
        });

        // load temporary cart data
        app.get('/temporaryData/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const result = await temporaryDataCollection.find(query).toArray();
            res.send(result);
        });

        // automatically delete temporary data 
        app.delete('/temporaryData/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const result = temporaryDataCollection.deleteMany(query);
            res.send(result);
        });

        // remove from cart 
        app.delete('/temporaryCartData/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await temporaryDataCollection.deleteOne(query);
            res.send(result);
        });

        // stripe
        app.post("/create-payment-intent", verifyJWT, async (req, res) => {
            const { grandTotal } = req.body;
            const amount = grandTotal * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ['card']
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        // store order data in database
        app.post('/orders', async (req, res) => {
            const details = req.body;
            const result = await orderCollection.insertOne(details);

            // send an email confirming payment
            sendPaymentConfirmationEmail(details);
            res.send(result);
        });

        // load my order data from database 
        app.get("/myOrders/:email", verifyJWT, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const myOrders = await orderCollection.find(query).toArray();
            res.send(myOrders);
        });

        // load orders from database 
        app.get("/orders", verifyJWT, verifyOwner, async (req, res) => {
            const query = {};
            const myOrders = await orderCollection.find(query).toArray();
            res.send(myOrders);
        });

        // update status
        app.patch('/orders/:id', verifyJWT, verifyOwner, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: { status: 'Shipped' }
            };
            const result = await orderCollection.updateOne(query, updateDoc);
            res.send(result);
        });

        // add print 
        app.post('/addPrint', verifyJWT, verifyOwner, async (req, res) => {
            const printData = req.body;
            const result = await printCollection.insertOne(printData);
            res.send(result);
        });

    } finally {

    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('The Memory Maker');
});

app.listen(port, () => {
    console.log(`listening to port ${port}`);
});