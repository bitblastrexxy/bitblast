// server.js

const express = require('express');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise'); // Assuming you are using MySQL
const bcrypt = require('bcrypt'); // For password hashing
const cors = require('cors');
const path = require('path');

dotenv.config(); // Load environment variables

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




// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});




// const express = require('express');
// const jwt = require('jsonwebtoken');
// const path = require('path');
// const bcrypt = require('bcrypt');
// const nodemailer = require('nodemailer');
// const pool = require('./config/db'); // Import the db.js file for MySQL connection
// const app = express();
// const PORT = process.env.PORT || 3000;

// app.use(express.json());
// app.use(express.static(path.join(__dirname))); // Serve static files from the main project folder

// // Replace this with your actual secret from environment variables
// const SECRET_KEY = process.env.JWT_SECRET || 'moniegram'; // Ensure this is set in your .env file

// // Serve the index.html file
// app.get('/', (req, res) => {
//     res.sendFile(path.join(__dirname, 'index.html'));
// });

// // Set up nodemailer
// const transporter = nodemailer.createTransport({
//     service: 'gmail',
//     auth: {
//         user: process.env.EMAIL_USER,
//         pass: process.env.EMAIL_PASS // Use the App Password here
//     }
// });

// app.post('/api/signup', async (req, res) => {
//     const { fullName, email, username, password, referrer } = req.body;

//     try {
//         const hashedPassword = await bcrypt.hash(password, 10);
        
//         // Generate a confirmation token using JWT
//         const confirmationToken = jwt.sign({ email, username }, SECRET_KEY, { expiresIn: '1h' });
//         console.log('Generated confirmation token:', confirmationToken); // Debugging line

//         // Store user details in the database
//         const [result] = await pool.query(
//             'INSERT INTO users (fullName, email, username, password, referrer, confirmationToken) VALUES (?, ?, ?, ?, ?, ?)',
//             [fullName, email, username, hashedPassword, referrer, confirmationToken]
//         );

//         // Send confirmation email
//         const confirmationLink = `http://localhost:3000/api/verify/${encodeURIComponent(confirmationToken)}`; // Use the appropriate domain for production
//         const mailOptions = {
//             from: process.env.EMAIL_USER,
//             to: email,
//             subject: 'Please confirm your email',
//             text: `Click this link to confirm your email: ${confirmationLink}`,
//         };

//         await transporter.sendMail(mailOptions);
//         res.status(201).json({ message: 'Sign-up successful! Please check your email to confirm your account.' });

//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ message: 'An error occurred while signing up. Please try again later.' });
//     }
// });


// // Verification endpoint
// app.get('/api/verify/:token', async (req, res) => {
//     const token = req.params.token;

//     console.log('Token received for verification:', token); // Debugging line

//     try {
//         const decoded = jwt.verify(token, SECRET_KEY);
//         const userId = decoded.id;

//         // Update user as verified in the database
//         const [rows] = await pool.query('UPDATE users SET verified = 1 WHERE email = ?', [decoded.email]);

//         if (rows.affectedRows === 0) {
//             return res.status(400).send({ message: 'User not found or already verified.' });
//         }

//         res.send({ message: 'Email verified successfully!' });
//     } catch (error) {
//         console.error('Token verification error:', error);
//         res.status(400).send({ message: 'Invalid token.' });
//     }
// });


// // Start server
// app.listen(PORT, () => {
//     console.log(`Server is running on:${PORT}`);
// });









// const express = require('express');
// const jwt = require('jsonwebtoken');
// const path = require('path');
// const bcrypt = require('bcrypt');
// const nodemailer = require('nodemailer');
// const crypto = require('crypto');
// const pool = require('./config/db'); // Import the db.js file for MySQL connection
// const app = express();
// const PORT = process.env.PORT || 3000;

// app.use(express.json());
// app.use(express.static(path.join(__dirname))); // Serve static files from the main project folder

// const SECRET_KEY = 'moniegram';

// // Serve the index.html file
// app.get('/', (req, res) => {
//     res.sendFile(path.join(__dirname, 'index.html'));
// });

// // Set up nodemailer

// const transporter = nodemailer.createTransport({
//     service: 'gmail',
//     auth: {
//         user: process.env.EMAIL_USER,
//         pass: process.env.EMAIL_PASS // Use the App Password here
//     }
// });

// module.exports = transporter;


// app.get('/api/verify/:token', async (req, res) => {
//     const token = req.params.token;

//     try {
//         const decoded = jwt.verify(token, process.env.JWT_SECRET); // Replace with your secret
//         const userId = decoded.id;

//         // Update user as verified in the database
//         const [rows] = await db.execute('UPDATE users SET verified = 1 WHERE id = ?', [userId]);

//         if (rows.affectedRows === 0) {
//             return res.status(400).send({ message: 'User not found or already verified.' });
//         }

//         res.send({ message: 'Email verified successfully!' });
//     } catch (error) {
//         console.error(error);
//         res.status(400).send({ message: 'Invalid token.' });
//     }
// });


// // Sign-up route
// app.post('/api/signup', async (req, res) => {
//     const { fullName, email, username, password, referrer } = req.body;

//     try {
//         // Hash the password
//         const hashedPassword = await bcrypt.hash(password, 10);
        
//         // Generate a confirmation token
//         const confirmationToken = crypto.randomBytes(32).toString('hex');

//         // Store user details in the database using the connection from db.js
//         const [result] = await pool.query(
//             'INSERT INTO users (fullName, email, username, password, referrer, confirmationToken) VALUES (?, ?, ?, ?, ?, ?)',
//             [fullName, email, username, hashedPassword, referrer, confirmationToken]
//         );

//         // Send confirmation email
//         const confirmationLink = `http://yourdomain.com/confirm?token=${confirmationToken}`;
//         const mailOptions = {
//             from: 'your_email@gmail.com',
//             to: email,
//             subject: 'Please confirm your email',
//             text: `Click this link to confirm your email: ${confirmationLink}`,
//         };

//         await transporter.sendMail(mailOptions);
//         res.status(201).json({ message: 'Sign-up successful! Please check your email to confirm your account.' });

//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ message: 'An error occurred while signing up. Please try again later.' });
//     }
// });

// // Start server
// app.listen(PORT, () => {
//     console.log(`Server is running on:${PORT}`);
// });
