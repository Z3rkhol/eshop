const express = require('express');
const path = require('path');
const mysql = require('mysql2');  // Import mysql2
const app = express();
const PORT = process.env.PORT || 3000;


const pool = mysql.createPool({
    host: 'localhost',          // Database host
    user: 'root',      // Database username
    password: '',  // Database password
    database: 'eshop',          // Database name
    waitForConnections: true,
    connectionLimit: 5,         // Optional: limits simultaneous connections
    queueLimit: 0
}).promise();  // Use promise-based API for async/await compatibility

// Test the database connection
async function testConnection() {
    try {
        const [rows] = await pool.query('SELECT 1'); // Basic test query
        console.log("Connected to the eshop database successfully!");
    } catch (err) {
        console.error("Failed to connect to the database:", err);
    }
}
testConnection();

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// Route to serve index.html as the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

// Example API route to fetch data from the database
app.get('/api/products', async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM products"); // Assuming 'products' table exists
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database query failed" });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
