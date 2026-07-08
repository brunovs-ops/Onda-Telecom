const express = require('express');
const crypto = require('crypto');

const router = express.Router();

const WEBHOOK_TOKEN = process.env.MOVEO_WEBHOOK_TOKEN;

function verifySignature(rawBody, signature, token) {
  const expected = crypto.createHmac('sha256', token).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function getCustomer(customerId) {
  const { rows } = await pool.query(
    'SELECT nome, plano, status_fatura, chamado FROM clientes WHERE telefone = $1',
    [customerId]
  );
  return rows[0] || null;
}

function buildLiveInstructions(customer) {
  return [
    `1. Nome do cliente: ${customer.nome}`,
    `2. Plano atual: ${customer.plano}`,
    `3. Situação da fatura: ${customer.status_fatura}`,
    `4. Chamado em aberto: ${customer.chamado}`,
  ].join('\n');
}

router.post('/webhook/primeira-mensagem', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const rawBody = req.body.toString('utf-8');
    const signature = req.headers['x-moveo-signature'];

    if (typeof signature !== 'string' || !verifySignature(rawBody, signature, WEBHOOK_TOKEN)) {
      return res.status(401).json({ error: 'invalid signature' });
    }

    const body = JSON.parse(rawBody);
    const customerId = body.context?.customer_id;

    const customer = await getCustomer(customerId);

    if (!customer) {
      return res.json({
        context: {
          live_instructions:
            'Cliente ainda não identificado. Peça educadamente o CPF ou o número da linha para localizar o cadastro antes de prosseguir.',
        },
      });
    }

    return res.json({
      context: { live_instructions: buildLiveInstructions(customer) },
    });
  } catch (err) {
    console.error('first-message webhook error:', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

module.exports = router;
