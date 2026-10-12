export const sizes = ['17x32','19x39','18x40','19x44','21x48','23x50','24x55','27x58','29x49','30x65','32x75','32x72','36x75','38x75','31x100','44x75'];
export type Customer = {id:string; name:string; phone:string|null};
export type Item = {size:string; quantity:number; rate:number};
export type Bill = {id:string; bill_number:number; sale_date:string; customer_id:string; customer_name:string; paid:boolean; items:Item[]; total:number};
export const money = (n:number) => new Intl.NumberFormat('en-SA',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
export const itemTotal = (item:Item) => Math.round(item.quantity * Math.round(item.rate * 100)) / 100;
export const billTotal = (items:Item[]) => Math.round(items.reduce((sum,i)=>sum+itemTotal(i),0)*100)/100;
export const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function validateItems(items:Item[]) { return items.length > 0 && items.every(i=>sizes.includes(i.size)&&Number.isSafeInteger(i.quantity)&&i.quantity>0&&i.quantity<=1000000&&Number.isFinite(i.rate)&&i.rate>0&&i.rate<=1000000&&Math.abs(i.rate*100-Math.round(i.rate*100))<0.00001); }
export function reportRows(bills:Bill[]) {
 const rows: (string|number)[][] = [['Bill number','Date','Customer','Status','Bag size','Bundles','Rate (SAR)','Item total (SAR)','Bill total (SAR)']];
 for(const b of bills) b.items.forEach((i,index)=>rows.push([b.bill_number,b.sale_date,b.customer_name,b.paid?'Paid':'Unpaid',i.size,i.quantity,i.rate,itemTotal(i),index===0?b.total:'']));
 rows.push(['TOTAL','','','','',bills.reduce((s,b)=>s+b.items.reduce((n,i)=>n+i.quantity,0),0),'','',Math.round(bills.reduce((s,b)=>s+b.total,0)*100)/100]);
 return rows;
}
