import {classCode} from './publication.js';

const date=process.argv[2];
const parsed=new Date(date+'T00:00:00Z');
const secret=process.env.CLASS_SECRET;
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0,10)!==date || !secret || secret.length<32) {
  throw new Error('Set CLASS_SECRET and pass the workshop date as YYYY-MM-DD.');
}
const link=new URL(process.env.MOKA_FRONTEND_URL??'https://boracles.github.io/moka-garden-ar/');
link.searchParams.set('date',date);
link.hash=new URLSearchParams({class:await classCode(secret,date)}).toString();
console.log(link.href);
