import { verifyPayment } from './server/payments.ts'

const res = await verifyPayment('ad051cbd8217c755abf66e76b2731435142fc552be79abe60ae094af60ac7c93', {
  priceLuna: 12412,
  memo: 'You mined NIM on Nimiq.Space!',
})
console.log(JSON.stringify(res))
