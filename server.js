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



// Define the sendEmail function
async function sendEmail(to, subject, htmlContent) {
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER, 
                pass: process.env.EMAIL_PASS 
            }
        });

        // Set up email options
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: to,
            subject: subject, 
            html: htmlContent
        };

        // Send the email
        await transporter.sendMail(mailOptions);
        console.log('Email sent successfully');
    } catch (error) {
        console.error('Error sending email:', error);
    }
}






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


app.post('/api/create-deposit', async (req, res) => {
    const { email, amount, deposit_method } = req.body; // Ensure deposit_method is used here

    if (!email || !amount || !deposit_method) {
        return res.status(400).json({ message: 'Missing required fields' });
    }

    const investmentStartDate = new Date(); // Current date for investment start
    const investmentEndDate = null; // Set to null for now, will calculate later

    try {
        // Insert into deposits table
        const depositResult = await db.query(
            'INSERT INTO deposits (email, amount, date, status, investment_start_date, investment_end_date, plan_name, deposit_method) VALUES (?, ?, NOW(), ?, ?, ?, ?, ?)',
            [email, amount, 'pending', investmentStartDate, investmentEndDate, null, deposit_method] // Plan name is null
        );

        // Insert into transactions table
        const transactionResult = await db.query(
            'INSERT INTO transactions (email, plan_name, plan_profit, plan_principle_return, plan_credit_amount, plan_deposit_fee, plan_debit_amount, deposit_method, transaction_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [email, null, null, null, amount, 0, amount, deposit_method] // Nulls for plan details, adjust if necessary
        );

        res.status(201).json({ message: 'Deposit created successfully', depositId: depositResult.insertId });
    } catch (error) {
        console.error('Error creating deposit:', error);
        res.status(500).json({ message: 'Error creating deposit', error });
    }
});



app.get('/users', (req, res) => {
    const username = req.query.username;
    if (!username) {
        return res.status(400).json({ message: 'Username is required' });
    }

    db.query('SELECT balance FROM users WHERE username = ?', [username], (err, results) => {
        if (err) return res.status(500).json({ error: err });
        res.json(results);
    });
});


app.post('/api/deposit', async (req, res) => {
    try {
        const { 
            email, // using email instead of username
            depositAmount, 
            planName, 
            planPrincipleReturn, 
            planCreditAmount, 
            planDepositFee, 
            planDebitAmount, 
            depositMethod 
        } = req.body;

        // Validate request body
        if (!email || !planName || !planCreditAmount || !depositAmount || !depositMethod) {
            return res.status(400).json({ message: "Please provide all required fields" });
        }

        // Check if user exists
        const [userResult] = await db.query('SELECT * FROM users WHERE email = ?', [email]); // Changed to db
        const user = userResult[0]; // Select the first user

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Handle balance deduction if deposit method is balance
        if (depositMethod === 'balance') {
            if (user.balance < depositAmount) {
                return res.status(400).json({ message: 'Insufficient balance' });
            }
            
            // Deduct the deposit amount from user's balance
            await db.query('UPDATE users SET balance = balance - ? WHERE email = ?', [depositAmount, email]); // Changed to db
        }

        // Calculate investment end date based on plan
        const planEndTimes = {
            '10% RIO AFTER 24 HOURS': 24 * 60 * 60 * 1000, // 24 hours in milliseconds
            '20% RIO AFTER 72 HOURS': 72 * 60 * 60 * 1000, // 72 hours in milliseconds
            '50% RIO LONG TERM': 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
            '100% RIO AFTER 30 DAYS': 30 * 24 * 60 * 60 * 1000 // 30 days in milliseconds
        };

        const investmentStartDate = new Date();
        const investmentEndDate = new Date(investmentStartDate.getTime() + (planEndTimes[planName] || 0));

        // Insert a new transaction into the transactions table
        await db.query(
            `INSERT INTO transactions 
            (email, plan_name, plan_principle_return, plan_credit_amount, plan_deposit_fee, plan_debit_amount, deposit_method, transaction_date) 
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [email, planName, planPrincipleReturn, planCreditAmount, planDepositFee, planDebitAmount, depositMethod] // Changed to db
        );

        // Insert the same details into the deposits table
        await db.query(
            `INSERT INTO deposits 
            (email, amount, date, investment_start_date, investment_end_date, plan_name, plan_principle_return, plan_credit_amount, plan_deposit_fee, plan_debit_amount, deposit_method, status) 
            VALUES ((SELECT email FROM users WHERE email = ?), ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [email, depositAmount, investmentStartDate, investmentEndDate, planName, planPrincipleReturn, planCreditAmount, planDepositFee, planDebitAmount, depositMethod] // Changed to db
        );

        // Send confirmation email
        const emailContent = `
            <div style="font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f4f4f4;">
                <table width="100%" style="max-width: 600px; margin: auto; border-collapse: collapse;">
                    <tr>
                        <td style="text-align: center; padding: 20px;">
                            <img src="https://github.com/bitblastrexxy/bitblast/blob/main/images/moniegram%20logo.png?raw=true" alt="Company Logo" style="max-width: 30%; height: auto;" />
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: #ffa62a; padding: 20px; text-align: center; color: white;">
                            <h1 style="margin: 0;">Deposit Successful!</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: white; padding: 20px;">
                            <p style="font-size: 16px; line-height: 1.5;">Dear ${email},</p>
                            <p style="font-size: 16px; line-height: 1.5;">Your deposit of $${depositAmount} has been successfully submitted. The deposit will be reflected in the "Active Deposits" tab once confirmed by the admin after blockchain verification.</p>
                            <p style="font-size: 16px; line-height: 1.5;">Thank you for investing with us!</p>
                            <a href="https://biggyinvestments.onrender.com/signin.html" style="display: inline-block; background-color: #ffa62a; color: white; padding: 10px 15px; text-decoration: none; border-radius: 5px;">Return to Dashboard</a>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: #f4f4f4; padding: 10px; text-align: center;">
                            <p style="font-size: 12px; color: #ffa62a;">&copy; 2024 BiggyassetsLTD. All rights reserved.</p>
                        </td>
                    </tr>
                </table>
            </div>
        `;

        // Call sendEmail to notify the user
        sendEmail(user.email, 'Deposit Confirmation', emailContent);

        res.json({ success: true, message: 'Deposit successful. Confirmation email sent.' });
    } catch (err) {
        console.error('Error processing deposit:', err); // Enhanced error logging
        res.status(500).json({ message: 'Error processing deposit' });
    }
});






// Route to fetch bitcoin_address and balance on page load
app.get('/api/user-info', (req, res) => {
    const { username } = req.query; // Username will be sent from the frontend
  
    pool.query(
        'SELECT bitcoin_address, balance FROM users WHERE username = ?',
        [username],
        (error, results) => {
            if (error) {
                console.error('Error fetching user info:', error);
                return res.status(500).json({ message: 'Error fetching user info.' });
            }
            if (results.length === 0) {
                return res.status(404).json({ message: 'User not found.' });
            }
            const userInfo = results[0];
            res.json(userInfo); // Send the bitcoin_address and balance
        }
    );
  });
  

































// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});