// Import necessary packages
const express = require('express');
const path = require('path');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fileUpload = require('express-fileupload');

// Initialize the express app
const app = express();
const PORT = process.env.PORT || 3000;


const pool = mysql.createPool({
    host: 'localhost',
    user: 'your_username',
    password: 'your_password',
    database: 'eshop',
    waitForConnections: true,
    connectionLimit: 10,
}).promise();

// Middleware for JSON parsing, file uploads, and serving frontend files
app.use(express.json());
app.use(fileUpload());
app.use(express.static(path.join(__dirname, '../frontend')));

// Middleware for authenticating JWTs (used for admin protection)
const authenticateJWT = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(403).json({ error: 'No token provided' });

    jwt.verify(token, 'your_jwt_secret', (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Unauthorized' });
        req.user = decoded;
        next();
    });
};

// =========================
// Client Routes
// =========================

// 1. User Registration
app.post('/api/register', async (req, res) => {
    const { username, password, email, currency } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            "INSERT INTO users (username, pass, email, currency, is_admin) VALUES (?, ?, ?, ?, 0)",
            [username, hashedPassword, email, currency]
        );
        res.json({ success: true, message: "User registered successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to register user" });
    }
});

// 2. User Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query("SELECT * FROM users WHERE username = ?", [username]);
        const user = rows[0];
        if (user && await bcrypt.compare(password, user.pass)) {
            const token = jwt.sign({ id: user.ID, isAdmin: user.is_admin }, 'your_jwt_secret');
            res.json({ success: true, token });
        } else {
            res.status(401).json({ error: "Invalid credentials" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Login failed" });
    }
});

// 3. List Products with Filtering and Currency Conversion
app.get('/api/products', async (req, res) => {
    const { search, category, currency = 'Kč' } = req.query;
    let query = "SELECT p.ID, p.name, p.price, p.stock, c.name AS category FROM products p LEFT JOIN categories c ON p.category_id = c.ID";
    const params = [];

    if (search) {
        query += " WHERE p.name LIKE ?";
        params.push(`%${search}%`);
    }
    if (category) {
        query += search ? " AND c.name = ?" : " WHERE c.name = ?";
        params.push(category);
    }

    try {
        const [rows] = await pool.query(query, params);
        rows.forEach(product => {
            product.price = currency === '€' ? product.price * 0.04 : product.price; // Adjust for exchange rate example
        });
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch products" });
    }
});

// 4. Add to Cart
app.post('/api/cart', async (req, res) => {
    const { userId, productId, quantity } = req.body;
    try {
        await pool.query("INSERT INTO cart (user_id, product_id, quantity) VALUES (?, ?, ?)", [userId, productId, quantity]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to add to cart" });
    }
});

// 5. Place Order
app.post('/api/order', async (req, res) => {
    const { userId, cartItems } = req.body;
    try {
        for (const item of cartItems) {
            const [product] = await pool.query("SELECT stock FROM products WHERE ID = ?", [item.productId]);
            if (product[0].stock < item.quantity) return res.status(400).json({ error: "Insufficient stock" });
            await pool.query("INSERT INTO orders (user_id, product_id, quantity) VALUES (?, ?, ?)", [userId, item.productId, item.quantity]);
            await pool.query("UPDATE products SET stock = stock - ? WHERE ID = ?", [item.quantity, item.productId]);
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to place order" });
    }
});

// =========================
// Admin Routes (Protected)
// =========================

// 6. Admin Product Management
app.post('/api/admin/products', authenticateJWT, async (req, res) => {
    if (!req.user.isAdmin) return res.status(403).json({ error: "Forbidden" });
    const { name, description, category_id, price, stock, currency } = req.body;
    const image = req.files ? req.files.image : null;
    const priceInKc = currency === '€' ? price / 0.04 : price; // Conversion example

    try {
        if (image) {
            const imagePath = `/uploads/${image.name}`;
            await image.mv(path.join(__dirname, '../frontend', imagePath)); // Save image in frontend/uploads
            await pool.query("INSERT INTO products (name, description, category_id, price, stock, image) VALUES (?, ?, ?, ?, ?, ?)",
                [name, description, category_id, priceInKc, stock, imagePath]);
        } else {
            await pool.query("INSERT INTO products (name, description, category_id, price, stock) VALUES (?, ?, ?, ?, ?)",
                [name, description, category_id, priceInKc, stock]);
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to add product" });
    }
});

// 7. Update Order Status (Admin only)
app.put('/api/admin/orders/:orderId', authenticateJWT, async (req, res) => {
    if (!req.user.isAdmin) return res.status(403).json({ error: "Forbidden" });
    const { status } = req.body; // 'completed' or 'cancelled'
    const { orderId } = req.params;

    try {
        await pool.query("UPDATE orders SET status = ? WHERE ID = ?", [status, orderId]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to update order" });
    }
});

// 8. Fetch Users (Admin only)
app.get('/api/admin/users', authenticateJWT, async (req, res) => {
    if (!req.user.isAdmin) return res.status(403).json({ error: "Forbidden" });
    try {
        const [rows] = await pool.query("SELECT ID, username, email, sales FROM users");
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// 9. Sales Statistics (Admin only)
app.get('/api/admin/sales-stats', authenticateJWT, async (req, res) => {
    if (!req.user.isAdmin) return res.status(403).json({ error: "Forbidden" });
    try {
        const [rows] = await pool.query(`
            SELECT p.name, SUM(o.quantity) AS total_sold 
            FROM orders o
            JOIN products p ON o.product_id = p.ID 
            GROUP BY p.ID
        `);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch sales statistics" });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
