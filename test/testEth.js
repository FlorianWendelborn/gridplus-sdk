// Tests for ETH transaction edge cases
// NOTE: You must run the following BEFORE executing these tests:
//
// 1. Pair with the device once. This will ask you for your deviceID, which will
//    act as a salt for your pairing:
//
//    env REUSE_KEY=1 npm run test
//
// 2. Connect with the same deviceID you specfied in 1:
//
//    env DEVICE_ID='<your_device_id>' npm test
//
// After you do the above, you can run this test with `npm run test-eth`
//
// NOTE: It is highly suggested that you set `AUTO_SIGN_DEV_ONLY=1` in the firmware
//        root CMakeLists.txt file (for dev units)
require('it-each')({ testPerIteration: true });
const randomWords = require('random-words');
const crypto = require('crypto');
const EthTx = require('ethereumjs-tx').Transaction;
const constants = require('./../src/constants')
const expect = require('chai').expect;
const helpers = require('./testUtil/helpers');
const HARDENED_OFFSET = constants.HARDENED_OFFSET;
let client = null;
let numRandom = 20; // Number of random tests to conduct
const randomTxData = [];
const randomTxDataLabels = [];
const ETH_GAS_LIMIT_MIN = 22000;        // Ether transfer (smallest op) is 22k gas
const ETH_GAS_LIMIT_MAX = 10000000;     // 10M is bigger than the block size
const ETH_GAS_PRICE_MAX = 500000000000; // 500,000,000,000 = 500 GWei - no one should need more
const ETH_GAS_PRICE_MIN = 1000000;      // 1,000,000 = 0.001 GWei - minimum

const defaultTxData = {
  nonce: 0,
  gasPrice: 1200000000,
  gasLimit: 50000,
  to: '0xe242e54155b1abc71fc118065270cecaaf8b7768',
  value: 100,
  data: null
};

function buildRandomTxData() {
  // Constants from firmware
  for (let i = 0; i < numRandom; i++) {
    const tx = {
      nonce: Math.floor(Math.random() * 16000),
      gasPrice: ETH_GAS_PRICE_MIN + Math.floor(Math.random() * (ETH_GAS_PRICE_MAX - ETH_GAS_PRICE_MIN)),
      gasLimit: ETH_GAS_LIMIT_MIN + Math.floor(Math.random() * (ETH_GAS_LIMIT_MAX - ETH_GAS_LIMIT_MIN)),
      value: Math.floor(Math.random() * 10**Math.floor(Math.random()*30)),
      to: `0x${crypto.randomBytes(20).toString('hex')}`,
      data: `0x${crypto.randomBytes(Math.floor(Math.random() * 100)).toString('hex')}`,
    }
    randomTxData.push(tx);
    randomTxDataLabels.push({ label: `${i+1}/${numRandom}`, number: i })
  }
}

function buildRandomMsg(type=constants.ethMsgProtocol.SIGN_PERSONAL.str) {
  if (type === constants.ethMsgProtocol.SIGN_PERSONAL.str) {
    // A random string will do
    const isHexStr = Math.random() > 0.5;
    const L = Math.floor(Math.random() * constants.ETH_MSG_MAX_SIZE);
    if (isHexStr)
      return `0x${crypto.randomBytes(L).toString('hex')}`; // Get L hex bytes (represented with a string with 2*L chars)
    else
      return randomWords({ exactly: L, join: ' ' }).slice(0, L); // Get L ASCII characters (bytes)
  }
}

function buildTxReq(txData, network='mainnet') {
  return {
    currency: 'ETH',
    data: {
      signerPath: [helpers.BTC_LEGACY_PURPOSE, helpers.ETH_COIN, HARDENED_OFFSET, 0, 0],
      ...txData,
      chainId: network
    }
  }
}

function buildMsgReq(payload, protocol) {
  return {
    currency: 'ETH_MSG',
    data: {
      signerPath: [helpers.BTC_LEGACY_PURPOSE, helpers.ETH_COIN, HARDENED_OFFSET, 0, 0],
      payload,
      protocol,
    }
  }
}

let foundError = false;

async function testTxPass(req) {
  const tx = await helpers.sign(client, req);
  // Make sure there is transaction data returned
  // (this is ready for broadcast)
  const txIsNull = tx.tx === null;
  if (txIsNull === true)
    foundError = true;
  expect(txIsNull).to.equal(false);

  // Check the transaction data against a reference implementation
  // (ethereumjs-tx)
  const txData = {
    ...req.data,
    v: tx.sig.v,
    r: `0x${tx.sig.r}`,
    s: `0x${tx.sig.s}`,
  }
  // There is one test where we submit an address without the prefix
  if (txData.to.slice(0, 2) !== '0x')
    txData.to = `0x${txData.to}`
  const expectedTx = new EthTx(txData, { chain: req.data.chainId }).serialize()
  const expectedTxStr = `0x${expectedTx.toString('hex')}`;
  if (tx.tx !== expectedTxStr) {
    foundError = true;
    console.log('Invalid tx resp!', JSON.stringify(txData))
  }
  expect(tx.tx).to.equal(expectedTxStr);
}

async function testTxFail(req) {
  try {
    const tx = await helpers.sign(client, req);
    expect(tx.tx).to.equal(null); 
  } catch (err) {
    expect(err).to.not.equal(null);
  }
}

async function testMsg(req, pass=true) {
  try {
    const sig = await helpers.sign(client, req);
    // Validation happens already in the client
    if (pass === true)
      expect(sig.sig).to.not.equal(null);
    else
      expect(sig.sig).to.equal(null);
  } catch (err) {
    if (pass === true)
      expect(err).to.equal(null);
    else
      expect(err).to.not.equal(null);
  }
}

// Build the random tx vectors
if (process.env.N)
  numRandom = parseInt(process.env.N);
buildRandomTxData();

describe('Setup client', () => {
  it('Should setup the test client', () => {
    client = helpers.setupTestClient(process.env);
    expect(client).to.not.equal(null);
  })

  it('Should connect to a Lattice and make sure it is already paired.', async () => {
    // Again, we assume that if an `id` has already been set, we are paired
    // with the hardcoded privkey above.
    expect(process.env.DEVICE_ID).to.not.equal(null);
    const connectErr = await helpers.connect(client, process.env.DEVICE_ID);
    expect(connectErr).to.equal(null);
    expect(client.isPaired).to.equal(true);
    expect(client.hasActiveWallet()).to.equal(true);
  });
})

if (!process.env.skip) {
  describe('Test ETH Tx Params', () => {
    beforeEach(() => {
      expect(foundError).to.equal(false, 'Error found in prior test. Aborting.');
      setTimeout(() => {}, 5000);
    })

    it('Should test range of `value`', async () => {
      const txData = JSON.parse(JSON.stringify(defaultTxData))
      
      // Expected passes
      txData.value = 100;
      await testTxPass(buildTxReq(txData))  
      txData.value = 10**18;
      await testTxPass(buildTxReq(txData))
      txData.value = 10**64;
      await testTxPass(buildTxReq(txData))
      txData.value = 10**77;
      await testTxPass(buildTxReq(txData))
      
      // Expected failures
      txData.value = 10**78;
      await testTxFail(buildTxReq(txData))
    });

    it('Should test the range of `data`', async () => {
      const txData = JSON.parse(JSON.stringify(defaultTxData))

      // Expected passes
      txData.data = null;
      await testTxPass(buildTxReq(txData))
      txData.data = '0x';
      await testTxPass(buildTxReq(txData))
      txData.data = '0x12345678';
      await testTxPass(buildTxReq(txData))

      // Check upper limit
      function buildDataStr(x, n) {
        x = x < 256 ? x : 0;
        const xs = x.toString(16).length === 1 ? `0${x.toString(16)}` : x.toString(16);
        let s = '0x';
        for (let i = 0; i < n; i++)
          s += xs
        return s;
      }
      txData.data = buildDataStr(1, constants.ETH_DATA_MAX_SIZE - 1)
      await testTxPass(buildTxReq(txData))
      txData.data = buildDataStr(2, constants.ETH_DATA_MAX_SIZE)  
      await testTxPass(buildTxReq(txData))

      // Expected failures
      txData.data = buildDataStr(3, constants.ETH_DATA_MAX_SIZE + 1)
      await testTxFail(buildTxReq(txData))
    });

    it('Should test the range of `gasPrice`', async () => {
      const txData = JSON.parse(JSON.stringify(defaultTxData));
      
      // Expected passes
      txData.gasPrice = ETH_GAS_PRICE_MIN;
      await testTxPass(buildTxReq(txData))
      txData.gasPrice = ETH_GAS_PRICE_MAX;
      await testTxPass(buildTxReq(txData))

      // Expected failures
      txData.gasPrice = 0;
      await testTxFail(buildTxReq(txData))
      txData.gasPrice = ETH_GAS_PRICE_MIN - 1;
      await testTxFail(buildTxReq(txData))
      txData.gasPrice = ETH_GAS_PRICE_MAX + 1;
      await testTxFail(buildTxReq(txData))
    });

    it('Should test the range of `gasLimit`', async () => {
      const txData = JSON.parse(JSON.stringify(defaultTxData));
      
      // Expected passes
      txData.gasLimit = ETH_GAS_LIMIT_MIN;
      await testTxPass(buildTxReq(txData))
      txData.gasLimit = ETH_GAS_LIMIT_MAX;
      await testTxPass(buildTxReq(txData))

      // Expected failures
      txData.gasLimit = 0;
      await testTxFail(buildTxReq(txData))
      txData.gasLimit = ETH_GAS_LIMIT_MIN - 1;
      await testTxFail(buildTxReq(txData))
      txData.gasLimit = ETH_GAS_LIMIT_MAX + 1;
      await testTxFail(buildTxReq(txData))
    });

    it('Should test the range of `to`', async () => {
      const txData = JSON.parse(JSON.stringify(defaultTxData));
      
      // Expected passes
      txData.to = '0xe242e54155b1abc71fc118065270cecaaf8b7768';
      await testTxPass(buildTxReq(txData))
      txData.to = 'e242e54155b1abc71fc118065270cecaaf8b7768';
      await testTxPass(buildTxReq(txData))

      // Expected failures
      txData.gasLimit = 0;
      await testTxFail(buildTxReq(txData))
      txData.gasLimit = 21999;
      await testTxFail(buildTxReq(txData))
      txData.gasLimit = 50000001;
      await testTxFail(buildTxReq(txData))
    });

    it('Should test the range of `nonce`', async () => {
      const txData = JSON.parse(JSON.stringify(defaultTxData));
      
      // Expected passes
      txData.nonce = 0;
      await testTxPass(buildTxReq(txData))
      txData.nonce = 4294967295;
      await testTxPass(buildTxReq(txData))
      
      // Expected failures
      txData.nonce = 4294967296;
      await testTxFail(buildTxReq(txData))
    });
    it('Should test EIP155', async () => {
      const txData = JSON.parse(JSON.stringify(defaultTxData));
      await testTxPass(buildTxReq(txData, 'rinkeby')) // Does NOT use EIP155
      await testTxPass(buildTxReq(txData, 'mainnet')) // Uses EIP155
    });

  });
}

describe('Test random transaction data', function() {
  beforeEach(() => {
    expect(foundError).to.equal(false, 'Error found in prior test. Aborting.');
  })

  it.each(randomTxDataLabels, 'Random transaction %s', ['label'], async function(n, next) {
    const txData = randomTxData[n.number];
    const r = Math.round(Math.random())
    const network = r === 1 ? 'rinkeby' : 'mainnet';
    try {
      await testTxPass(buildTxReq(txData, network))
      setTimeout(() => { next() }, 2500);
    } catch (err) {
      console.log('error from payload', network, txData)
      setTimeout(() => { next(err) }, 2500);
    }
  })
})

describe('Test random ETH messages', function() {
  beforeEach(() => {
    expect(foundError).to.equal(false, 'Error found in prior test. Aborting.');
  })

  it.each(randomTxDataLabels, 'Msg: sign_personal #%s', ['label'], async function(n, next) {
    const protocol = constants.ethMsgProtocol.SIGN_PERSONAL.str;
    const payload = buildRandomMsg(protocol);
    try {
      await testMsg(buildMsgReq(payload, protocol))
      setTimeout(() => { next() }, 2500);
    } catch (err) {
      setTimeout(() => { next(err) }, 2500);
    }
  })

  it('Msg: sign_personal boundary conditions', async () => {
    const protocol = constants.ethMsgProtocol.SIGN_PERSONAL.str;
    const maxValid = `0x${crypto.randomBytes(constants.ETH_MSG_MAX_SIZE).toString('hex')}`;
    const minInvalid = `0x${crypto.randomBytes(constants.ETH_MSG_MAX_SIZE + 1).toString('hex')}`;
    const zeroInvalid = '0x';
    await testMsg(buildMsgReq(maxValid, protocol), true);
    await testMsg(buildMsgReq(minInvalid, protocol), false);
    await testMsg(buildMsgReq(zeroInvalid, protocol), false);
  })
})