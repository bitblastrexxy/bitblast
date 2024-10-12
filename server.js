const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const pool = require('./config/db'); // Import the db.js file for MySQL connection
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname))); // Serve static files from the main project folder

const SECRET_KEY = 'moniegram';

// Serve the index.html file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Set up nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'your_email@gmail.com',
        pass: 'your_email_password', // Use an app-specific password if needed
    },
});

// Sign-up route
app.post('/api/signup', async (req, res) => {
    const { fullName, email, username, password, referrer } = req.body;

    try {
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Generate a confirmation token
        const confirmationToken = crypto.randomBytes(32).toString('hex');

        // Store user details in the database using the connection from db.js
        const [result] = await pool.query(
            'INSERT INTO users (fullName, email, username, password, referrer, confirmationToken) VALUES (?, ?, ?, ?, ?, ?)',
            [fullName, email, username, hashedPassword, referrer, confirmationToken]
        );

        // Send confirmation email
        const confirmationLink = `http://yourdomain.com/confirm?token=${confirmationToken}`;
        const mailOptions = {
            from: 'your_email@gmail.com',
            to: email,
            subject: 'Please confirm your email',
            text: `Click this link to confirm your email: ${confirmationLink}`,
        };

        await transporter.sendMail(mailOptions);
        res.status(201).json({ message: 'Sign-up successful! Please check your email to confirm your account.' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'An error occurred while signing up. Please try again later.' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on:${PORT}`);
});
