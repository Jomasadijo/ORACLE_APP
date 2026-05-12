const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DERIV_APP_ID = process.env.DERIV_APP_ID;

const DB_PATH = path.join(__dirname, 'database.json');

function readDB() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ clients: [] }, null, 2));
    }

    return JSON.parse(fs.readFileSync(DB_PATH));
}

function saveDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

app.get('/api/clients', (req, res) => {
    const db = readDB();
    res.json(db.clients);
});

app.post('/api/save-client', async (req, res) => {
    try {
        const { token } = req.body;

        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);

        ws.on('open', () => {
            ws.send(JSON.stringify({ authorize: token }));
        });

        ws.on('message', (msg) => {
            const data = JSON.parse(msg);

            if (data.error) {
                return res.status(400).json(data.error);
            }

            if (data.msg_type === 'authorize') {
                const db = readDB();

                const exists = db.clients.find(c => c.loginid === data.authorize.loginid);

                if (!exists) {
                    db.clients.push({
                        loginid: data.authorize.loginid,
                        email: data.authorize.email || 'N/A',
                        balance: data.authorize.balance,
                        currency: data.authorize.currency,
                        token,
                        connected_at: new Date().toISOString(),
                        estimated_commission: 0,
                        trade_volume: 0,
                        active: true
                    });

                    saveDB(db);
                }

                startTradeTracking(token, data.authorize.loginid);

                return res.json({
                    success: true,
                    client: data.authorize
                });
            }
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

function startTradeTracking(token, loginid) {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);

    ws.on('open', () => {
        ws.send(JSON.stringify({ authorize: token }));

        setTimeout(() => {
            ws.send(JSON.stringify({
                proposal_open_contract: 1,
                subscribe: 1
            }));
        }, 1000);
    });

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);

        if (data.msg_type === 'proposal_open_contract') {
            const contract = data.proposal_open_contract;

            if (contract.is_sold) {
                const stake = Number(contract.buy_price || 0);
                const commission = stake * 0.02;

                const db = readDB();

                const client = db.clients.find(c => c.loginid === loginid);

                if (client) {
                    client.trade_volume += stake;
                    client.estimated_commission += commission;
                    client.last_trade = new Date().toISOString();

                    saveDB(db);
                }
            }
        }
    });
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
