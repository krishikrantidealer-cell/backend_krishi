const axios = require('axios');
require('dotenv').config();

const OBD_URL = 'https://obd-api.myoperator.co/obd-api-v1';
const API_KEY = process.env.MYOPERATOR_CALLING_X_API_KEY || 'oomfKA3I2K6TCJYistHyb7sDf0l0F6c8AZro5DJh';
const SECRET_KEY = process.env.MYOPERATOR_CALLING_SECRET_KEY || 'd1160ee08c6afe8984492e716ef062fbaf912e6f86cf851a94122c6a2aaaec25';
const COMPANY_ID = process.env.MYOPERATOR_COMPANY_ID || '6ab0de5d51766538';

const AGENTS = [
  { name: 'Anshika Gupta', phone: '9399022067', did: '07316917267', ivr: '6ac391dc6b832209', uuid: '6abe3b1d94d37977' },
  { name: 'Runa Singh', phone: '9201896604', did: '07316917220', ivr: '6ac3926ed5589198', uuid: '6abe3cdaa65d9730' },
  { name: 'Ajay Yadav', phone: '9201896606', did: '07316917210', ivr: '6ac392e50b66c496', uuid: '6abe3e4363d3e779' },
  { name: 'Ram Ji Shukla', phone: '9399022063', did: '07316917208', ivr: '6abf9971d5b34126', uuid: '6abe40026e466397' },
  { name: 'Garima', phone: '9201896603', did: '07316917216', ivr: '6ac3932d1bae5749', uuid: '6abe41494bcb1499' },
];

async function check() {
  console.log('--- TESTING MYOPERATOR CREDENTIAL CONFIGURATION ---');
  console.log(`Global Company ID: ${COMPANY_ID}`);
  console.log(`Global API Key: ${API_KEY.slice(0, 8)}...`);

  for (const a of AGENTS) {
    console.log(`\nAgent: ${a.name} (${a.phone})`);
    console.log(`  DID: ${a.did} | IVR: ${a.ivr} | UUID: ${a.uuid}`);
  }
}

check();
