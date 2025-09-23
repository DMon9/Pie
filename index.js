// index.js — Pi Squared Backend (Express)
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// --- In-memory demo storage ---
let contests = [
  { id: "c_001", type: "H2H", title: "Eagles vs Cowboys - 1Q > 10.5", entry: 10, fee: 0.5, status: "OPEN" },
  { id: "c_002", type: "POOL", title: "Sunday NFL TD Pool", entry: 5, fee: 0.25, status: "OPEN" }
];
let picks = [
  { id: "p_1", contest_id: "c_002", side: "Over", stake: 10, status: "PENDING" }
];
let squares = {
  id: "sq_100",
  game: "Eagles @ Cowboys",
  price: 2,
  size: 10,
  claimed: { "3,7": "0xabc...123" }
};

// --- Routes ---
app.get("/", (req, res) => {
  res.send("✅ Pi Squared Backend is running");
});

// Contests
app.get("/contests", (req, res) => res.json(contests));
app.post("/contests", (req, res) => {
  const c = { id: "c_" + Date.now(), ...req.body, status: "OPEN" };
  contests.push(c);
  res.json({ ok: true, id: c.id });
});

// Picks
app.get("/picks", (req, res) => res.json(picks));

// Squares
app.get("/squares/:id?", (req, res) => res.json(squares));
app.post("/squares/:id/claim", (req, res) => {
  const { x, y, wallet } = req.body;
  if (!wallet) return res.status(400).json({ ok: false, error: "Missing wallet" });
  const key = `${x},${y}`;
  if (squares.claimed[key]) return res.status(400).json({ ok: false, error: "Already claimed" });
  squares.claimed[key] = wallet;
  res.json({ ok: true, x, y, wallet });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`🚀 Pi Squared Backend running on port ${PORT}`);
});
