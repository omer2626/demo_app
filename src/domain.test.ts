import {describe,it,expect} from 'vitest';
import {billTotal,validateItems,reportRows,sizes,type Bill} from './domain';
describe('Sales calculations',()=>{
 it('uses halala precision for fractional bundle prices',()=>{expect(billTotal([{size:'17x32',quantity:3,rate:0.1},{size:'19x39',quantity:2,rate:10.25}])).toBe(20.8)});
 it('rejects fractional bundles, missing sizes, invalid prices and excess decimals',()=>{for(const item of [{size:'17x32',quantity:1.5,rate:10},{size:'',quantity:1,rate:10},{size:'17x32',quantity:1,rate:-1},{size:'17x32',quantity:1,rate:1.001}])expect(validateItems([item])).toBe(false);expect(validateItems([])).toBe(false)});
 it('accepts all sixteen products',()=>{expect(sizes).toHaveLength(16);for(const size of sizes)expect(validateItems([{size,quantity:1,rate:1.25}])).toBe(true)});
 it('counts a multi-item bill exactly once in Excel totals',()=>{const bill:Bill={id:'1',bill_number:1001,sale_date:'2026-10-13',customer_id:'1',customer_name:'Farm',paid:false,items:[{size:'17x32',quantity:2,rate:10},{size:'19x39',quantity:3,rate:20}],total:80};const rows=reportRows([bill]);expect(rows[1][8]).toBe(80);expect(rows[2][8]).toBe('');expect(rows[3][8]).toBe(80);expect(rows[3][5]).toBe(5);expect(rows[1][3]).toBe('Unpaid')});
});
