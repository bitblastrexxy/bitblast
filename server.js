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
app.use(router);
app.use(express.json()); // Parse JSON bodies
app.use(express.static(path.join(__dirname)));
app.use(express.static(__dirname));



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

        // Check if the user is admin first
        if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
            console.log('Admin login successful for:', email);
            return res.json({ success: true, message: 'Admin login successful!', userEmail: email, isAdmin: true });
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

        // Successful login for normal user
        console.log('Login successful for user:', email);
        res.json({ success: true, message: 'Login successful!', userEmail: email, isAdmin: false });

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



app.post('/api/getBalance', async (req, res) => {
    const { email } = req.body;

    try {
        const [result] = await db.query('SELECT balance FROM users WHERE email = ?', [email]);

        if (result.length > 0) {
            const balance = result[0].balance;
            res.json({ success: true, balance });
        } else {
            res.status(404).json({ success: false, message: 'User not found' });
        }
    } catch (err) {
        console.error('Error fetching balance:', err);
        res.status(500).json({ success: false, message: 'Error fetching balance' });
    }
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
  
    db.query( // Change pool to db
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


// Route to fetch deposits and withdrawals
app.get('/api/transactions', async (req, res) => {
    const { email } = req.query; // Email will be sent from the frontend

    try {
        const [withdrawals] = await db.query(
            'SELECT amount, request_date, status FROM pending_withdrawals WHERE email = ?',
            [email]
        );

        const [deposits] = await db.query(
            'SELECT amount, deposit_method, date, status FROM deposits WHERE email = ?',
            [email]
        );

        res.json({ withdrawals, deposits });
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ message: 'Error fetching transactions.' });
    }
});









// Assuming 'db' is the pool from your db.js file
app.post('/api/withdraw', (req, res) => {
    console.log('Withdrawal endpoint hit');
    
    const { userEmail, amount, method, walletAddress, bankDetails } = req.body;
  
    console.log("Withdrawal request received for user:", userEmail);
    console.log("Amount:", amount);
    console.log("Withdrawal method:", method);

    // Step 0: Check if the db object is defined
    if (!db) {
        console.error('Database connection (db) is not defined.');
        return res.status(500).json({ message: 'Database connection error.' });
    }

    let query = '';
    let queryParams = [];
  
    // Proceed with the withdrawal request without checking the balance
    if (method === 'bank') {
        const { bankName, accountName, accountNumber } = bankDetails;
        query = 'INSERT INTO pending_withdrawals (email, amount, status, request_date, bank_name, account_name, account_number, method) VALUES (?, ?, ?, NOW(), ?, ?, ?, ?)';
        queryParams = [userEmail, amount, 'pending', bankName, accountName, accountNumber, method];
        console.log("Bank withdrawal for user:", userEmail);
    } else if (method === 'wallet') {
        query = 'INSERT INTO pending_withdrawals (email, amount, status, request_date, wallet_address, method) VALUES (?, ?, ?, NOW(), ?, ?)';
        queryParams = [userEmail, amount, 'pending', walletAddress, method];
        console.log("Wallet withdrawal for user:", userEmail);
    } else {
        console.log("Invalid withdrawal method.");
        return res.status(400).json({ message: 'Invalid withdrawal method selected.' });
    }
  
    console.log("Executing query:", query, "with params:", queryParams);  // Log the query being executed
  
    // Step 3: Insert the withdrawal request into pending_withdrawals table
    db.query(query, queryParams, (err, result) => {
        if (err) {
            console.error('Error inserting withdrawal request:', err);  // Check for database query errors
            return res.status(500).json({ message: 'Error processing withdrawal request.' });
        }

        if (result.affectedRows === 0) {
            console.log("No rows inserted, something went wrong.");
            return res.status(500).json({ message: 'Error inserting withdrawal into the database.' });
        }
        
        console.log('Withdrawal request inserted successfully with ID:', result.insertId);
        res.json({ message: 'Withdrawal request submitted successfully.' });
    });
});



// Global error handlers for unhandled errors
process.on('uncaughtException', (err) => {
    console.error('Unhandled exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
});




app.post('/api/assets', async (req, res) => {
    try {
        const { email } = req.body; // Extract email from the request body
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        
        // Fetch active deposits for the user
        const [deposits] = await db.query('SELECT * FROM active_deposits WHERE email = ?', [email]);
        
        // Fetch transactions for the user
        const [transactions] = await db.query('SELECT * FROM transactions WHERE email = ?', [email]);

        // Calculate total amount of active deposits
        const totalAmount = deposits.length > 0 ? deposits.reduce((acc, deposit) => acc + deposit.amount, 0) : 0;

        // Ensure totalAmount is a number
        res.json({ totalAmount: Number(totalAmount), deposits, transactions }); // Send the data as JSON response
    } catch (error) {
        console.error('Error fetching assets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});



app.get('/get-user-profile', async (req, res) => {
    console.log(req.query);  // Add this to debug
    const email = req.query.email;
    try {
        const [rows] = await db.execute('SELECT fullName, phone, address, email, profile_image FROM users WHERE email = ?', [email]);
        if (rows.length > 0) {
            res.json({ success: true, ...rows[0] });
        } else {
            res.json({ success: false, message: "User not found." });
        }
    } catch (err) {
        console.error('Error:', err);  // Log the error to debug
        res.json({ success: false, message: "Error fetching profile." });
    }
});


app.post('/update-profile', async (req, res) => {
    const { fullName, phone, address, current_password, new_password, confirm_password, email } = req.body;

    try {
        // Validate current password if user tries to change it
        if (current_password && new_password && confirm_password) {
            const [user] = await db.execute('SELECT password FROM users WHERE email = ?', [email]);
            if (!bcrypt.compareSync(current_password, user[0].password)) {
                return res.json({ success: false, message: "Incorrect current password." });
            }
            if (new_password !== confirm_password) {
                return res.json({ success: false, message: "New passwords do not match." });
            }
            const hashedPassword = bcrypt.hashSync(new_password, 10);
            await db.execute('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, email]);
        }

        // Update other fields
        await db.execute('UPDATE users SET fullName = ?, phone = ?, address = ? WHERE email = ?', [fullName, phone, address, email]);
        res.json({ success: true, message: "Profile updated successfully." });
    } catch (err) {
        res.json({ success: false, message: "Error updating profile." });
    }
});

app.post('/update-profile-picture', async (req, res) => {
    const { email } = req.body;
    const profileImage = req.files.profile_image;

    try {
        // Save profile image to disk and store its path in the database
        const imagePath = `/uploads/${profileImage.name}`;
        profileImage.mv(`./public/uploads/${profileImage.name}`);
        await db.execute('UPDATE users SET profile_image = ? WHERE email = ?', [imagePath, email]);

        res.json({ success: true, message: "Profile picture updated.", profile_image_url: imagePath });
    } catch (err) {
        res.json({ success: false, message: "Error updating profile picture." });
    }
});



app.get('/api/stocks', (req, res) => {
    const options = {
        method: 'GET',
        hostname: 'yahoo-finance-api-data.p.rapidapi.com',
        port: null,
        path: '/search/list-detail?id=a4f8a58b-e458-44fe-b304-04af382a364e&limit=10&offset=0',
        headers: {
            'x-rapidapi-key': '665e2072eemsh27d4020afed09f6p1e7c0fjsn1c3c3bfeedde', // Replace with your key
            'x-rapidapi-host': 'yahoo-finance-api-data.p.rapidapi.com'
        }
    };

    // Use a different variable name to avoid conflicts
    const stockRequest = https.request(options, (apiRes) => {
        let chunks = [];

        apiRes.on('data', (chunk) => {
            chunks.push(chunk);
        });

        apiRes.on('end', () => {
            const body = Buffer.concat(chunks);
            const result = JSON.parse(body.toString());
            res.json(result); // Send data to the front-end
        });
    });

    stockRequest.on('error', (e) => {
        console.error(`Problem with request: ${e.message}`);
        res.status(500).send('Error fetching stock data');
    });

    stockRequest.end();
});




app.post('/verify-payment', async (req, res) => {
    const { reference, amount } = req.body;
    const paystackSecretKey = 'sk_live_9531183b8354a342dbe10d01e3abee48e6d9f07e';  // replace with your live secret key
  
    try {
      const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`
        }
      });
  
      const paymentData = response.data.data;
  
      if (paymentData && paymentData.status === 'success' && paymentData.amount / 100 === amount && paymentData.currency === 'USD') {
        // Successful payment in USD
        return res.json({ success: true, message: 'Payment verified successfully.' });
      } else {
        return res.json({ success: false, message: 'Payment verification failed.' });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error during payment verification.' });
    }
  });
  







//admin


// Route to get the count of pending deposits
app.get('/api/admin/pending-deposits', async (req, res) => {
    try {
        const [deposits] = await db.query(
            `SELECT id, email, amount, plan_name, status, date 
             FROM deposits 
             WHERE status = 'pending'`
        );
        res.json(deposits); // Send the deposits list to the frontend
    } catch (error) {
        console.error('Error fetching pending deposits:', error);
        res.status(500).json({ message: 'Error fetching pending deposits' });
    }
});


// Approve a deposit
router.post('/api/admin/pending-deposits/approve/:id', async (req, res) => {
    const depositId = req.params.id;

    try {
        // Fetch deposit details
        const [depositResult] = await db.query('SELECT * FROM deposits WHERE id = ?', [depositId]);
        if (!depositResult.length) {
            return res.status(404).json({ message: 'Deposit not found' });
        }

        const { email, amount, plan_name, investment_start_date } = depositResult[0];

        // If plan_name exists, fetch the plan details; otherwise, set default values
        let planDetails = {};
        let interest = 0;
        let startDate = new Date();
        let endDate = new Date();
        if (plan_name) {
            // Fetch plan details
            const [planResult] = await db.query('SELECT duration, profit FROM plans WHERE name = ?', [plan_name]);
            if (planResult.length) {
                const { duration, profit } = planResult[0];
                planDetails = { plan_name, profit };
                interest = amount * (profit / 100);
                startDate = new Date(investment_start_date);
                endDate = new Date(startDate.getTime() + duration * 60 * 60 * 1000);
            } else {
                return res.status(404).json({ message: 'Plan not found' });
            }
        } else {
            // For wallet deposits, set default values
            planDetails = { plan_name: 'Wallet Deposit', profit: 0 };
            interest = 0; // No interest for wallet deposit
            startDate = new Date();
            endDate = new Date();
        }

        // Update deposit status
        await db.query('UPDATE deposits SET status = ? WHERE id = ?', ['approved', depositId]);

        // Insert into active deposits
        await db.query(
            `INSERT INTO active_deposits (email, amount, interest, plan_name, profit, investment_start_date, investment_end_date) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [email, amount, interest, planDetails.plan_name, planDetails.profit, startDate, endDate]
        );

        res.json({ message: 'Deposit approved and moved to active deposits successfully' });
    } catch (error) {
        console.error('Error approving deposit:', error);
        res.status(500).json({ message: 'Error approving deposit' });
    }
});





// Reject a deposit
app.post('/api/admin/reject-deposit', async (req, res) => {
    const { depositId } = req.body;

    try {
        // Step 1: Check if deposit exists
        const [depositResult] = await db.query('SELECT * FROM deposits WHERE id = ?', [depositId]);
        if (!depositResult.length) {
            return res.status(404).json({ message: 'Deposit not found' });
        }

        // Step 2: Move deposit to rejected_deposits
        await db.query(
            `INSERT INTO rejected_deposits 
             (id, email, amount, status, date) 
             SELECT id, email, amount, status, date FROM deposits WHERE id = ?`,
            [depositId]
        );

        // Step 3: Delete deposit from deposits table
        await db.query('DELETE FROM deposits WHERE id = ?', [depositId]);

        res.json({ message: 'Deposit rejected successfully' });
    } catch (error) {
        console.error('Error rejecting deposit:', error);
        res.status(500).json({ message: 'Error rejecting deposit' });
    }
});




app.get('/api/pending-withdrawals', async (req, res) => {
    try {
        const [results] = await db.query('SELECT * FROM pending_withdrawals WHERE status = ?', ['Pending']);
        res.status(200).json(results);
    } catch (error) {
        console.error('Error fetching pending withdrawals:', error);
        res.status(500).json({ error: 'Failed to fetch pending withdrawals' });
    }
});



// Approve Withdrawal
app.post('/api/withdrawals/approve', async (req, res) => {
    const { id } = req.body;

    try {
        const [result] = await db.query(
            'UPDATE pending_withdrawals SET status = ?, approved_date = NOW() WHERE id = ?',
            ['Approved', id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Withdrawal not found' });
        }

        res.status(200).json({ message: 'Withdrawal approved successfully' });
    } catch (error) {
        console.error('Error approving withdrawal:', error);
        res.status(500).json({ message: 'Error approving withdrawal' });
    }
});

// Reject Withdrawal and Refund User
app.post('/api/withdrawals/reject', async (req, res) => {
    const { id } = req.body;

    try {
        // Start a transaction
        await db.query('START TRANSACTION');

        // Fetch withdrawal details
        const [withdrawal] = await db.query('SELECT email, amount FROM pending_withdrawals WHERE id = ?', [id]);

        if (withdrawal.length === 0) {
            return res.status(404).json({ message: 'Withdrawal not found' });
        }

        const { email, amount } = withdrawal[0];

        // Update withdrawal status to Rejected
        const [updateWithdrawal] = await db.query(
            'UPDATE pending_withdrawals SET status = ? WHERE id = ?',
            ['Rejected', id]
        );

        if (updateWithdrawal.affectedRows === 0) {
            throw new Error('Failed to update withdrawal status');
        }

        // Refund the amount to the user's balance
        const [updateBalance] = await db.query(
            'UPDATE users SET balance = balance + ? WHERE email = ?',
            [amount, email]
        );

        if (updateBalance.affectedRows === 0) {
            throw new Error('Failed to update user balance');
        }

        // Commit the transaction
        await db.query('COMMIT');
        res.status(200).json({ message: 'Withdrawal rejected and refunded successfully' });
    } catch (error) {
        // Rollback transaction on error
        await db.query('ROLLBACK');
        console.error('Error rejecting withdrawal:', error);
        res.status(500).json({ message: 'Error rejecting withdrawal and refunding amount' });
    }
});








// // Route to get the total number of users
// app.get('/api/admin/total-users', (req, res) => {
//     pool.query('SELECT COUNT(*) AS total_users FROM users', (error, results) => {
//         if (error) {
//             console.error('Error fetching total users:', error);
//             return res.status(500).json({ message: 'Error fetching total users.' });
//         }
//         res.json(results[0]);
//     });
//   });
  

// Route to get all users' details
app.get('/api/admin/users', async (req, res) => {
    try {
        const query = `
            SELECT id, fullName, email, username, bitcoin_address, referrer, createdAt, updatedAt, otp, verified, phone, address, profile_image, balance
            FROM users
        `;
        // Use db pool to execute the query
        const [results] = await db.query(query);
        res.json(results); // Send the results back as JSON
    } catch (error) {
        console.error('Error fetching user details:', error);
        res.status(500).json({ message: 'Error fetching user details.' });
    }
});



app.get('/api/admin/transactions', async (req, res) => {
    const query = `
        SELECT id, email, plan_name, plan_profit, plan_principle_return, 
               plan_credit_amount, plan_deposit_fee, plan_debit_amount, 
               deposit_method, transaction_date
        FROM transactions
    `;

    try {
        const [results] = await db.query(query);  // Using promise-based query here
        res.json(results);  // Send results as JSON
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ message: 'Error fetching transactions' });
    }
});



app.get('/api/admin/deposits', async (req, res) => {
    try {
        console.log('Fetching all deposits...');
        const query = `
            SELECT id, email, amount, date, status, investment_start_date, investment_end_date,
                   plan_name, plan_principle_return, plan_credit_amount, plan_deposit_fee, plan_debit_amount, deposit_method
            FROM deposits
        `;

        // Execute the query to fetch all deposits
        const [results] = await db.query(query);
        console.log('Results:', results);

        // Send the results as a JSON response
        res.json(results);
    } catch (error) {
        console.error('Error fetching deposits:', error);
        res.status(500).json({ message: 'Error fetching deposits' });
    }
});



app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        console.log('Fetching all withdrawals...');
        const query = `
            SELECT id, email, amount, status, request_date, approved_date, wallet_address, method,
                   bank_name, account_name, account_number
            FROM pending_withdrawals
        `;

        // Execute the query to fetch all withdrawals
        const [results] = await db.query(query);
        console.log('Results:', results);

        // Send the results as a JSON response
        res.json(results);
    } catch (error) {
        console.error('Error fetching withdrawals:', error);
        res.status(500).json({ message: 'Error fetching withdrawals' });
    }
});


// Handle the newsletter send request
app.post('/api/admin/send-newsletter', async (req, res) => {
    const { subject, content, targetGroups } = req.body;

    try {
        const users = [];
        let query = '';

        for (const group of targetGroups) {
            if (group === 'allUsers') {
                query = 'SELECT email FROM users'; // Fetch all users' emails
            } else if (group === 'noInvestments') {
                query = `SELECT email FROM users WHERE id NOT IN 
                         (SELECT user_id FROM investments)`; // Users with no investments
            } else if (group === 'zeroBalance') {
                query = 'SELECT email FROM users WHERE balance = 0'; // Users with zero balance
            } else if (group === 'activeInvestments') {
                // Fetch users with active deposits from the active_deposits table
                query = `
        SELECT u.email 
        FROM users u
        JOIN active_deposits ad ON u.email = ad.email
        WHERE ad.investment_end_date > NOW()`; // Active investments (from active_deposits table)
            } else if (group.startsWith('specificPlan:')) {
                const planName = group.split(':')[1];
                query = `
                    SELECT u.email 
                    FROM users u
                    JOIN active_deposits ad ON u.email = ad.email
                    WHERE ad.plan_name = ?`;
                const [result] = await db.query(query, [planName]);
                users.push(...result.map(user => user.email));
                continue;
            }
            

            const [result] = await db.query(query);
            users.push(...result.map(user => user.email));
        }

        // Remove duplicate emails
        const uniqueEmails = [...new Set(users)];

        // Send email to each user
        for (const email of uniqueEmails) {
            await sendEmail(email, subject, content);
        }

        res.status(200).json({ message: 'Newsletter sent successfully' });
    } catch (error) {
        console.error('Error sending newsletter:', error);
        res.status(500).json({ message: 'Failed to send the newsletter' });
    }
});







// // Approve withdrawal with email notification and detailed query check
// app.post('/api/admin/approve-withdrawal', (req, res) => {
//     const { id, username, amount } = req.body;
  
//     // Update status to 'approved' in the pending_withdrawals table
//     pool.query('UPDATE pending_withdrawals SET status = ? WHERE id = ?', ['approved', id], (error, result) => {
//         if (error) {
//             console.error('Error approving withdrawal:', error);
//             return res.status(500).json({ message: 'Error approving withdrawal' });
//         }
  
//         // Check if any rows were affected
//         if (result.affectedRows === 0) {
//             console.error('No rows updated. Possible incorrect ID:', id);
//             return res.status(404).json({ message: 'Withdrawal not found or already processed' });
//         }
  
//         console.log('Withdrawal approved, ID:', id);
  
//         // Send email notification after approval
//         pool.query('SELECT email FROM users WHERE username = ?', [username], (err, results) => {
//             if (err) {
//                 console.error('Error fetching user email:', err);
//                 return res.status(500).json({ message: 'Error fetching user information' });
//             }
  
//             const userEmail = results[0]?.email;
//             if (userEmail) {
//                 const mailOptions = {
//                     from: 'your_email@gmail.com',
//                     to: userEmail,
//                     subject: 'Withdrawal Approved',
//                     text: `Dear ${username}, your withdrawal of $${amount} has been approved!`
//                 };
  
//                 transporter.sendMail(mailOptions, (mailError) => {
//                     if (mailError) {
//                         console.error('Error sending email:', mailError);
//                     }
//                 });
//             }
  
//             res.json({ message: 'Withdrawal approved successfully and email notification sent!' });
//         });
//     });
//   });
  
//   // Reject withdrawal with email notification and detailed query check
//   app.post('/api/admin/reject-withdrawal', (req, res) => {
//     const { id, username, amount } = req.body;
  
//     // Update status to 'rejected' in the pending_withdrawals table
//     pool.query('UPDATE pending_withdrawals SET status = ? WHERE id = ?', ['rejected', id], (error, result) => {
//         if (error) {
//             console.error('Error rejecting withdrawal:', error);
//             return res.status(500).json({ message: 'Error rejecting withdrawal' });
//         }
  
//         // Check if any rows were affected
//         if (result.affectedRows === 0) {
//             console.error('No rows updated. Possible incorrect ID:', id);
//             return res.status(404).json({ message: 'Withdrawal not found or already processed' });
//         }
  
//         console.log('Withdrawal rejected, ID:', id);
  
//         // Refund the amount back to the user's balance
//         pool.query('UPDATE users SET balance = balance + ? WHERE username = ?', [amount, username], (err, updateResult) => {
//             if (err) {
//                 console.error('Error updating user balance:', err);
//                 return res.status(500).json({ message: 'Error updating user balance' });
//             }
  
//             // Send email notification after rejection
//             pool.query('SELECT email FROM users WHERE username = ?', [username], (emailError, results) => {
//                 if (emailError) {
//                     console.error('Error fetching user email:', emailError);
//                     return res.status(500).json({ message: 'Error fetching user information' });
//                 }
  
//                 const userEmail = results[0]?.email;
//                 if (userEmail) {
//                     const mailOptions = {
//                         from: 'your_email@gmail.com',
//                         to: userEmail,
//                         subject: 'Withdrawal Rejected',
//                         text: `Dear ${username}, your withdrawal of $${amount} has been rejected and the amount has been refunded to your balance.`
//                     };
  
//                     transporter.sendMail(mailOptions, (mailError) => {
//                         if (mailError) {
//                             console.error('Error sending email:', mailError);
//                         }
//                     });
//                 }
  
//                 res.json({ message: 'Withdrawal rejected, amount refunded, and email notification sent!' });
//             });
//         });
//     });
//   });
  


// Adding penalty route
// app.post('/api/admin/add-penalty', async (req, res) => {
//     const { userId, penaltyAmount, penaltyType, description, authPassword } = req.body;

//     // Check if the provided authPassword matches the admin password from environment variables
//     if (authPassword !== process.env.ADMIN_PASSWORD) {
//         return res.status(403).json({ success: false, message: 'Unauthorized' });
//     }

//     try {
//         // Find the user by userId
//         const [users] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);

//         if (users.length === 0) {
//             return res.status(404).json({ success: false, message: 'User not found' });
//         }

//         const user = users[0]; // Select the user

//         // Deduct the penalty amount from the user's balance
//         const newBalance = parseFloat(user.balance) - parseFloat(penaltyAmount);

//         // Update the user's balance
//         await db.query('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId]);

//         // Log the penalty in the penalties table
//         await db.query(
//             'INSERT INTO penalties (user_id, amount, type, description) VALUES (?, ?, ?, ?)',
//             [userId, penaltyAmount, penaltyType, description]
//         );

//         // Send success response
//         res.json({ success: true, message: 'Penalty added successfully.' });
//     } catch (error) {
//         console.error('Error adding penalty:', error);
//         res.status(500).json({ success: false, message: 'Server error' });
//     }
// });

  
  
// async function addBonus(userId, amount, description) {
//     try {
//         // Fetch username based on userId
//         const [userResult] = await db.query('SELECT username FROM users WHERE id = ?', [userId]);

//         if (!userResult.length) {
//             throw new Error('User not found');
//         }

//         const username = userResult[0].username;

//         // Update user balance
//         await db.query('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, userId]);

//         // Insert into transactions table
//         const [transactionResult] = await db.query(
//             `INSERT INTO transactions (username, plan_name, plan_credit_amount, deposit_method, transaction_date) 
//              VALUES (?, ?, ?, ?, ?)`,
//             [username, null, amount, 'Bonus', new Date()]
//         );

//         return transactionResult;
//     } catch (error) {
//         console.error('Error adding bonus:', error);
//         throw error;
//     }
// }

//   app.post('/api/admin/add-bonus-or-investment', async (req, res) => {
//     const { userId, amount, actionType, planId, description, authPassword } = req.body;
  
//     try {
//       // Authenticate admin's password before proceeding
//       const adminPassword = process.env.ADMIN_PASSWORD;
//       if (authPassword !== adminPassword) {
//         return res.status(401).json({ message: 'Invalid admin password' });
//       }
  
//       // Fetch username based on userId
//       const [user] = await pool.promise().query('SELECT username FROM users WHERE id = ?', [userId]);
//       if (!user.length) {
//         return res.status(404).json({ message: 'User not found' });
//       }
  
//       const username = user[0].username;
  
//       if (actionType === 'bonus') {
//         // Handle the existing bonus logic
//         await addBonus(userId, amount, description);
//         await logTransaction(username, null, null, description); // Pass username
//         return res.json({ success: true, message: 'Bonus added successfully' });
//       }
  
//       if (actionType === 'investment') {
//         const [plan] = await pool.promise().query('SELECT * FROM plans WHERE id = ?', [planId]);
//         if (!plan.length) {
//           return res.status(404).json({ message: 'Plan not found' });
//         }
  
//         const { duration, profit } = plan[0];
//         const investmentStartDate = new Date();
//         const investmentEndDate = new Date(investmentStartDate.getTime() + duration * 60 * 60 * 1000);
//         const interest = amount * (profit / 100);
  
//         // Debugging: Log userId and other variables
//         console.log('Inserting investment with:', {
//           userId,
//           amount,
//           interest,
//           planName: plan[0].name,  // Fixed reference
//           profit,
//           investmentStartDate,
//           investmentEndDate,
//         });
  
//         // Insert the new investment into the active_deposits table
//         await pool.promise().query(
//           `INSERT INTO active_deposits (user_id, amount, interest, plan_name, profit, investment_start_date, investment_end_date) 
//           VALUES (?, ?, ?, ?, ?, ?, ?)`,
//           [userId, amount, interest, plan[0].name, profit, investmentStartDate, investmentEndDate]
//         );
  
//         // Log the transaction in the transactions table
//         await logTransaction(username, plan[0].name, amount, description); // Use username
  
//         return res.json({ success: true, message: 'Investment added successfully' });
//       }
  
//       res.status(400).json({ message: 'Invalid action type' });
//     } catch (err) {
//       console.error('Error in add-bonus-or-investment:', err);
//       res.status(500).json({ message: 'Error in add-bonus-or-investment' });
//     }
//   });



  // Adjusted route
app.get('/api/expiring-deposits', async (req, res) => {
    try {
        const [deposits] = await db.query(`
            SELECT *, DATEDIFF(investment_end_date, NOW()) AS days_left
            FROM active_deposits
            WHERE investment_end_date > NOW()
        `);
        res.json(deposits);
    } catch (err) {
        console.error('Error fetching expiring deposits:', err);
        res.status(500).json({ message: 'Error fetching expiring deposits' });
    }
});

  




//   app.get('/get-account-details', (req, res) => {
//     const username = req.query.username;
  
//     if (!username) {
//         return res.json({ success: false, message: "Username is required." });
//     }
  
//     // Get a connection from the pool
//     pool.getConnection((err, connection) => {
//         if (err) {
//             return res.json({ success: false, message: "Error connecting to the database." });
//         }
  
//         // Query user data based on the username to get user_id
//         const userQuery = `SELECT id, full_name, username, created_at, balance FROM users WHERE username = ?`;
//         connection.query(userQuery, [username], (err, userResults) => {
//             if (err) {
//                 connection.release(); // Release connection back to the pool
//                 return res.json({ success: false, message: "Error fetching user data." });
//             }
  
//             if (userResults.length === 0) {
//                 connection.release(); // Release connection back to the pool
//                 return res.json({ success: false, message: "User not found." });
//             }
  
//             const user = userResults[0];
//             const userId = user.id;
  
//             // Query approved deposits using user_id
//             const approvedDepositsQuery = `SELECT amount, date FROM deposits WHERE user_id = ? AND status = 'approved'`;
//             connection.query(approvedDepositsQuery, [userId], (err, approvedDeposits) => {
//                 if (err) {
//                     connection.release(); // Release connection back to the pool
//                     return res.json({ success: false, message: "Error fetching approved deposits." });
//                 }
  
//                 // Query pending deposits using user_id
//                 const pendingDepositsQuery = `SELECT amount, date FROM deposits WHERE user_id = ? AND status = 'pending'`;
//                 connection.query(pendingDepositsQuery, [userId], (err, pendingDeposits) => {
//                     connection.release(); // Release connection after the last query
  
//                     if (err) {
//                         return res.json({ success: false, message: "Error fetching pending deposits." });
//                     }
  
//                     // Return account details, approved deposits, and pending deposits
//                     res.json({
//                         success: true,
//                         full_name: user.full_name,
//                         username: user.username,
//                         created_at: user.created_at,
//                         balance: user.balance,
//                         approvedDeposits: approvedDeposits,
//                         pendingDeposits: pendingDeposits
//                     });
//                 });
//             });
//         });
//     });
//   });


























app.use((req, res, next) => {
    req.setTimeout(500000);  // Adjust as necessary (in milliseconds)
    next();
});


// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});