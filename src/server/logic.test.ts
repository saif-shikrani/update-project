import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'
import {
  combineCosts,
  costFromPayload,
  durationSeconds,
  extractText,
  extractWaMedia,
  nextStatus,
  normalizeNumber,
  pairReplies,
  recordMatches,
  toUnits,
  fromUnits,
  priceUnits,
  purchaseBlock,
  transcriptLines,
  verifyTelnyx,
} from './logic.ts'

test('duration is answered time only', () => {
  assert.equal(durationSeconds(null, '2026-01-01T00:01:00.000Z'), 0)
  assert.equal(durationSeconds('2026-01-01T00:00:00.000Z', '2026-01-01T00:01:30.000Z'), 90)
  assert.equal(durationSeconds('2026-01-01T00:02:00.000Z', '2026-01-01T00:01:00.000Z'), 0)
})

test('call status does not move backwards', () => {
  assert.equal(nextStatus('answered', 'ringing'), 'answered')
  assert.equal(nextStatus('ringing', 'answered'), 'answered')
  assert.equal(nextStatus('hangup', 'initiated'), 'hangup')
})

test('numbers become E.164 digits', () => {
  assert.equal(normalizeNumber('+1 (415) 555-1212'), '+14155551212')
  assert.equal(normalizeNumber('123'), null)
})

test('inbound text ignores media and keeps wrapped text', () => {
  assert.equal(extractText({ imageMessage: { caption: 'no' } }), null)
  assert.equal(extractText({ conversation: ' hello ' }), 'hello')
  assert.equal(extractText({ ephemeralMessage: { message: { extendedTextMessage: { text: 'later' } } } }), 'later')
  assert.equal(extractText({ deviceSentMessage: { message: { conversation: 'from the phone' } } }), 'from the phone')
})

test('WhatsApp media metadata survives common wrappers', () => {
  assert.deepEqual(extractWaMedia({
    ephemeralMessage: {
      message: {
        documentMessage: {
          mimetype: 'application/pdf',
          fileName: 'invoice.pdf',
          caption: 'Here it is',
        },
      },
    },
  }), {
    kind: 'document',
    mimeType: 'application/pdf',
    fileName: 'invoice.pdf',
    caption: 'Here it is',
  })
  assert.deepEqual(extractWaMedia({ imageMessage: { mimetype: 'image/jpeg' } })?.kind, 'image')
})

test('money units keep four decimal places', () => {
  assert.equal(toUnits('25'), 250000)
  assert.equal(toUnits('0.0040'), 40)
  assert.equal(toUnits('1.5'), 15000)
  assert.equal(toUnits('1.23456'), null)
  assert.equal(fromUnits(40), '0.0040')
  assert.equal(fromUnits(-250000), '-25.0000')
  assert.equal(priceUnits('1.00000'), 10000)
  assert.equal(priceUnits('$1.00'), 10000)
  assert.equal(purchaseBlock(0, '1.00000', '1.00000')?.status, 402)
  assert.equal(purchaseBlock(5000, '1.00000', '1.00000')?.status, 402)
  assert.equal(purchaseBlock(10000, '1.00000', '1.00000'), null)
})

test('cost comes from the webhook total or its parts', () => {
  assert.deepEqual(costFromPayload({ total_cost: '0.012', currency: 'USD', billed_duration_secs: 60 }), {
    amount: '0.0120',
    currency: 'USD',
    billableSeconds: 60,
  })
  assert.equal(costFromPayload({ cost_parts: [{ cost: '0.001', currency: 'USD' }, { cost: '0.002' }] })?.amount, '0.0030')
  assert.equal(costFromPayload({}), null)
})

test('detail records match call ids and keep one cost per record type', () => {
  assert.equal(recordMatches({ telnyx_session_id: 'sess' }, ['sess']), true)
  assert.equal(recordMatches({ session_id: 'registration' }, ['registration']), false)
  assert.deepEqual(combineCosts([
    { record_type: 'webrtc_detail_record', cost: '0.001', currency: 'USD', billed_sec: 60 },
    { record_type: 'webrtc_detail_record', cost: '9', currency: 'USD' },
    { record_type: 'sip-trunking', cost: '0.004', currency: 'USD', billed_sec: 30 },
  ]), { amount: '0.0050', currency: 'USD', billableSeconds: 60 })
})

test('summary transcript drops the oldest lines past the cap', () => {
  const messages = Array.from({ length: 205 }, (_, index) => ({
    timestamp: String(index),
    pushName: 'A',
    body: `m${index}`,
  }))
  const transcript = transcriptLines(messages)
  assert.equal(transcript.omitted, 5)
  assert.equal(transcript.text.startsWith('5 A: m5'), true)
  assert.equal(transcript.text.endsWith('204 A: m204'), true)
})

test('reply pairs use your replies and ignore automatic ones', () => {
  const pairs = pairReplies([
    { chatJid: 'a', body: 'hi', fromMe: false, source: 'user' },
    { chatJid: 'a', body: 'hello', fromMe: true, source: 'user' },
    { chatJid: 'a', body: 'price?', fromMe: false, source: 'user' },
    { chatJid: 'a', body: 'bot reply', fromMe: true, source: 'auto' },
    { chatJid: 'b', body: 'there?', fromMe: false, source: 'user' },
  ])
  assert.deepEqual(pairs, [{ them: 'hi', us: 'hello' }])
})

test('webhook signatures accept the Telnyx public key', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
  const timestamp = String(Math.floor(Date.now() / 1000))
  const body = '{"data":{}}'
  const signature = sign(null, Buffer.from(`${timestamp}|${body}`), privateKey).toString('base64')
  assert.equal(verifyTelnyx(body, timestamp, signature, raw), true)
  assert.equal(verifyTelnyx(body, timestamp, signature, raw.slice(0, 8)), false)
  assert.equal(verifyTelnyx(body, '1', signature, raw), false)
})
