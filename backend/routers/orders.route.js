const express = require('express');
const Order = require('../models/order.model'); // adjust path if needed

const router = express.Router();

// Create order
router.post('/', async (req, res) => {
    try {
        const order = await new Order(req.body).save();
        res.status(201).json(order);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// List orders
router.get('/', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get order by id
router.get('/:id', async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ error: 'Not found' });
        res.json(order);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Update order
router.put('/:id', async (req, res) => {
    try {
        const order = await Order.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        if (!order) return res.status(404).json({ error: 'Not found' });
        res.json(order);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Delete order
router.delete('/:id', async (req, res) => {
    try {
        const order = await Order.findByIdAndDelete(req.params.id);
        if (!order) return res.status(404).json({ error: 'Not found' });
        res.status(204).end();
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;