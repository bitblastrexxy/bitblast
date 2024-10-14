// server.js
const express = require('express');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise'); // Assuming you are using MySQL
const bcrypt = require('bcrypt'); // For password hashing
const router = express.Router();
const cors = require('cors');
const path = require('path');

dotenv.config(); // Load environment variables

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors()); // Enable CORS
app.use(express.json()); // Parse JSON bodies
app.use(express.static(path.join(__dirname)));

// MySQL database connection
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

app.post('/api/signup', async (req, res) => {
    const { fullName, email, username, password, referrer } = req.body;

    try {
        // Check if user already exists
        const [existingUser] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

        if (existingUser.length > 0) {
            return res.status(400).json({ message: 'Email already exists' });
        }

        // No password hashing - storing password as plain text for now
        const plainPassword = password;

        // Debug: Log the password before storing it
        console.log('Plain text password to be stored:', plainPassword);

        // Insert new user into the database
        await db.query('INSERT INTO users (fullName, email, username, password, referrer, verified) VALUES (?, ?, ?, ?, ?, ?)', 
            [fullName, email, username, plainPassword, referrer, false]);

        // Verify the user was inserted and password saved
        const insertedUser = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        console.log('Inserted user:', insertedUser[0]);

        // Generate OTP and JWT
        const otp = Math.floor(100000 + Math.random() * 900000); // Generates a 6-digit OTP
        const token = jwt.sign({ email, otp }, process.env.JWT_SECRET, { expiresIn: '10m' }); // token valid for 10 minutes

        // Store the OTP in the database
        await db.query('UPDATE users SET otp = ? WHERE email = ?', [otp, email]);

        // Send OTP email
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Your OTP Code for Moniegram',
            text: `Hello, ${fullName}. Here is your OTP code: ${otp}. It will expire in 10 minutes. Your verification token is: ${token}`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error sending email:', error);
                return res.status(500).json({ message: 'Failed to send OTP. Please try again.' });
            } else {
                console.log('Email sent: ' + info.response);
                res.json({ message: 'Signup successful! Please check your email for the OTP.', token });
            }
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ message: 'Signup failed. Please try again.' });
    }
});





// Simplified OTP verification route
app.post('/api/verify-otp', async (req, res) => {
    const { email, otp } = req.body;

    try {
        // Check if the email and OTP match in the database
        const [user] = await db.query('SELECT * FROM users WHERE email = ? AND otp = ?', [email, otp]);

        if (!user) {
            return res.status(400).json({ success: false, message: 'Invalid OTP. Please try again.' });
        }

        // Mark user as verified
        await db.query('UPDATE users SET verified = ? WHERE email = ?', [true, email]);

        res.json({ success: true, message: 'Email verified successfully! You can now log in.' });
    } catch (error) {
        console.error('OTP verification error:', error);
        res.status(500).json({ success: false, message: 'An error occurred during verification. Please try again.' });
    }
});


app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Check for missing email or password
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required.' });
        }

        // Fetch user from the database
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

        // Ensure the query returns a user
        if (users.length === 0) {
            console.log('User not found:', email);
            return res.status(400).json({ success: false, message: 'Invalid email or password.' });
        }

        const user = users[0]; // Get the first user object

        // Debugging: Check the fetched user details
        console.log('Fetched user:', user);
        console.log('User password from DB:', user.password);
        console.log('Password from client:', password);

        // Check if the password is present in the database
        if (!user.password) {
            console.log('User password is missing for email:', email);
            return res.status(400).json({ success: false, message: 'User password is missing.' });
        }

        // Directly compare the plain text passwords
        if (password !== user.password) {
            console.log('Password mismatch for user:', email);
            return res.status(400).json({ success: false, message: 'Invalid email or password.' });
        }

        // Successful login
        console.log('Login successful for user:', email);
        res.json({ success: true, message: 'Login successful!' });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'An error occurred during login.' });
    }
});



// API route to get user balance
app.get('/api/getBalance', async (req, res) => {
    const userEmail = req.query.email;

    if (!userEmail) {
        return res.status(400).json({ error: 'Email is required' });
    }

    try {
        const [results] = await db.query('SELECT balance FROM users WHERE email = ?', [userEmail]);
        
        if (results.length > 0) {
            res.json({ balance: results[0].balance });
        } else {
            res.json({ balance: null }); // User not found
        }
    } catch (error) {
        console.error('Error fetching balance:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});


app.post('/api/create-payment-intent', async (req, res) => {
    const { amount } = req.body; // Get amount from request

    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: 'usd', // Change this to your desired currency
            // Optional: Add more options here if needed
        });
        res.send({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).send({ error: 'Failed to create payment intent.' });
    }
});



router.get('/api/deposit-history', async (req, res) => {
    const userEmail = req.query.email; // You can pass email as a query parameter
    
    try {
        const results = await db.query(`
            SELECT date, deposit_method, amount, status
            FROM deposits
            WHERE email = ? ORDER BY date DESC
        `, [userEmail]);

        res.json(results);
    } catch (error) {
        console.error('Error fetching deposit history:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
































// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});