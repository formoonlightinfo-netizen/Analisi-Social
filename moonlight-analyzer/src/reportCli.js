import 'dotenv/config';
import { generateReport } from './report.js';

const report = generateReport();
console.log(JSON.stringify(report, null, 2));
