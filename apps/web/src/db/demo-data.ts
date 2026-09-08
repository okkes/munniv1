// GENERATED from apps/legacy/src/features/accounts/data.js by scripts/port-demo-data.mjs.
// Dates are day-offsets so the demo dataset is always recent relative to
// seeding time.
export interface DemoAccount {
  id: string;
  name: string;
  type: string;
  iban: string;
  bankId: string;
  color: string;
  balanceCents: number;
}

export interface DemoTx {
  id: string;
  daysAgo: number;
  time: string;
  merchant: string;
  desc: string;
  cat: string;
  amountCents: number;
  account: string;
  splits?: { catId: string; amountCents: number }[];
  needsReview?: boolean;
  confidence?: number;
  reimbursements?: { txId: string; amountCents: number }[];
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    "id": "demo_main",
    "name": "Demo Checking · ING",
    "type": "checking",
    "iban": "NL00 DEMO 0000 0001 00",
    "bankId": "ing",
    "color": "#4A6A4F",
    "balanceCents": 342055
  },
  {
    "id": "demo_save",
    "name": "Demo Savings · ING",
    "type": "savings",
    "iban": "NL00 DEMO 0000 0002 00",
    "bankId": "ing",
    "color": "#A8782B",
    "balanceCents": 815000
  }
];

export const DEMO_TXS: DemoTx[] = [
  {"id":"dm1","daysAgo":176,"time":"08:00","merchant":"Demo Corp BV","desc":"DEMO CORP BV SALARIS DEC","cat":"salary","amountCents":220000,"account":"demo_main"},
  {"id":"dm2","daysAgo":174,"time":"00:00","merchant":"Demo Verhuur","desc":"DEMO VERHUUR HUUR DEC","cat":"housingRent","amountCents":-85000,"account":"demo_main"},
  {"id":"dm3","daysAgo":171,"time":"07:00","merchant":"Eneco","desc":"ENECO ENERGIE DEC","cat":"housingUtility","amountCents":-7200,"account":"demo_main"},
  {"id":"dm4","daysAgo":169,"time":"09:00","merchant":"Spotify","desc":"SPOTIFY SUBSCR DEC","cat":"subs","amountCents":-999,"account":"demo_main"},
  {"id":"dm5","daysAgo":167,"time":"09:00","merchant":"Netflix","desc":"NETFLIX SUBSCR DEC","cat":"subs","amountCents":-1399,"account":"demo_main"},
  {"id":"dm6","daysAgo":179,"time":"14:30","merchant":"Albert Heijn","desc":"AH DEMO 0001","cat":"groceries","amountCents":-5240,"account":"demo_main"},
  {"id":"dm7","daysAgo":172,"time":"11:20","merchant":"Jumbo","desc":"JUMBO DEMO 0042","cat":"groceries","amountCents":-3880,"account":"demo_main"},
  {"id":"dm8","daysAgo":165,"time":"15:00","merchant":"Albert Heijn","desc":"AH DEMO 0001","cat":"groceries","amountCents":-6130,"account":"demo_main"},
  {"id":"dm9","daysAgo":177,"time":"09:15","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-450,"account":"demo_main"},
  {"id":"dm10","daysAgo":170,"time":"08:30","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-450,"account":"demo_main"},
  {"id":"dm11","daysAgo":173,"time":"19:30","merchant":"Demo Restaurant","desc":"DEMO RESTAURANT AMS","cat":"restaurants","amountCents":-3850,"account":"demo_main"},
  {"id":"dm12","daysAgo":166,"time":"09:00","merchant":"Savings transfer","desc":"DEMO SPAAROVERBOEKING","cat":"savingDeposit","amountCents":-20000,"account":"demo_main"},
  {"id":"dm13","daysAgo":146,"time":"08:00","merchant":"Demo Corp BV","desc":"DEMO CORP BV SALARIS JAN","cat":"salary","amountCents":220000,"account":"demo_main"},
  {"id":"dm14","daysAgo":144,"time":"00:00","merchant":"Demo Verhuur","desc":"DEMO VERHUUR HUUR JAN","cat":"housingRent","amountCents":-85000,"account":"demo_main"},
  {"id":"dm15","daysAgo":141,"time":"07:00","merchant":"Eneco","desc":"ENECO ENERGIE JAN","cat":"housingUtility","amountCents":-7200,"account":"demo_main"},
  {"id":"dm16","daysAgo":139,"time":"09:00","merchant":"Spotify","desc":"SPOTIFY SUBSCR JAN","cat":"subs","amountCents":-999,"account":"demo_main"},
  {"id":"dm17","daysAgo":137,"time":"09:00","merchant":"Netflix","desc":"NETFLIX SUBSCR JAN","cat":"subs","amountCents":-1399,"account":"demo_main"},
  {"id":"dm18","daysAgo":149,"time":"16:00","merchant":"Albert Heijn","desc":"AH DEMO 0001","cat":"groceries","amountCents":-4520,"account":"demo_main"},
  {"id":"dm19","daysAgo":142,"time":"12:30","merchant":"Jumbo","desc":"JUMBO DEMO 0042","cat":"groceries","amountCents":-5560,"account":"demo_main"},
  {"id":"dm20","daysAgo":135,"time":"17:00","merchant":"Albert Heijn","desc":"AH DEMO 0001","cat":"groceries","amountCents":-4280,"account":"demo_main"},
  {"id":"dm21","daysAgo":128,"time":"10:00","merchant":"Lidl","desc":"LIDL DEMO","cat":"groceries","amountCents":-3140,"account":"demo_main"},
  {"id":"dm22","daysAgo":147,"time":"09:00","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-450,"account":"demo_main"},
  {"id":"dm23","daysAgo":140,"time":"08:30","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-380,"account":"demo_main"},
  {"id":"dm24","daysAgo":145,"time":"20:00","merchant":"Demo Restaurant","desc":"DEMO RESTAURANT AMS","cat":"restaurants","amountCents":-2800,"account":"demo_main"},
  {"id":"dm25","daysAgo":148,"time":"14:00","merchant":"NS · Sprinter","desc":"NS DEMO REIZIGERS","cat":"transportPublic","amountCents":-1840,"account":"demo_main"},
  {"id":"dm26","daysAgo":136,"time":"09:00","merchant":"Savings transfer","desc":"DEMO SPAAROVERBOEKING","cat":"savingDeposit","amountCents":-15000,"account":"demo_main"},
  {"id":"dm27","daysAgo":116,"time":"08:00","merchant":"Demo Corp BV","desc":"DEMO CORP BV SALARIS FEB","cat":"salary","amountCents":220000,"account":"demo_main"},
  {"id":"dm28","daysAgo":114,"time":"00:00","merchant":"Demo Verhuur","desc":"DEMO VERHUUR HUUR FEB","cat":"housingRent","amountCents":-85000,"account":"demo_main"},
  {"id":"dm29","daysAgo":111,"time":"07:00","merchant":"Eneco","desc":"ENECO ENERGIE FEB","cat":"housingUtility","amountCents":-6800,"account":"demo_main"},
  {"id":"dm30","daysAgo":109,"time":"09:00","merchant":"Spotify","desc":"SPOTIFY SUBSCR FEB","cat":"subs","amountCents":-999,"account":"demo_main"},
  {"id":"dm31","daysAgo":107,"time":"09:00","merchant":"Netflix","desc":"NETFLIX SUBSCR FEB","cat":"subs","amountCents":-1399,"account":"demo_main"},
  {"id":"dm32","daysAgo":119,"time":"13:00","merchant":"Albert Heijn","desc":"AH DEMO 0001","cat":"groceries","amountCents":-5890,"account":"demo_main"},
  {"id":"dm33","daysAgo":112,"time":"11:00","merchant":"Jumbo","desc":"JUMBO DEMO 0042","cat":"groceries","amountCents":-4450,"account":"demo_main"},
  {"id":"dm34","daysAgo":105,"time":"16:30","merchant":"Albert Heijn","desc":"AH DEMO 0001","cat":"groceries","amountCents":-6720,"account":"demo_main"},
  {"id":"dm35","daysAgo":117,"time":"08:45","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-450,"account":"demo_main"},
  {"id":"dm36","daysAgo":110,"time":"09:15","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-380,"account":"demo_main"},
  {"id":"dm37","daysAgo":115,"time":"21:00","merchant":"Demo Restaurant","desc":"DEMO RESTAURANT AMS","cat":"restaurants","amountCents":-4500,"account":"demo_main"},
  {"id":"dm38","daysAgo":118,"time":"15:00","merchant":"NS · Sprinter","desc":"NS DEMO REIZIGERS","cat":"transportPublic","amountCents":-2240,"account":"demo_main"},
  {"id":"dm39","daysAgo":108,"time":"14:00","merchant":"Etos","desc":"ETOS DEMO","cat":"healthcare","amountCents":-1850,"account":"demo_main"},
  {"id":"dm40","daysAgo":106,"time":"09:00","merchant":"Savings transfer","desc":"DEMO SPAAROVERBOEKING","cat":"savingDeposit","amountCents":-20000,"account":"demo_main"},
  {"id":"dm41","daysAgo":86,"time":"08:00","merchant":"Demo Corp BV","desc":"DEMO CORP BV SALARIS MAR","cat":"salary","amountCents":220000,"account":"demo_main"},
  {"id":"dm42","daysAgo":84,"time":"00:00","merchant":"Demo Verhuur","desc":"DEMO VERHUUR HUUR MAR","cat":"housingRent","amountCents":-85000,"account":"demo_main"},
  {"id":"dm43","daysAgo":81,"time":"07:00","merchant":"Eneco","desc":"ENECO ENERGIE MAR","cat":"housingUtility","amountCents":-6500,"account":"demo_main"},
  {"id":"dm44","daysAgo":79,"time":"09:00","merchant":"Spotify","desc":"SPOTIFY SUBSCR MAR","cat":"subs","amountCents":-999,"account":"demo_main"},
  {"id":"dm45","daysAgo":77,"time":"09:00","merchant":"Netflix","desc":"NETFLIX SUBSCR MAR","cat":"subs","amountCents":-1399,"account":"demo_main"},
  {"id":"dm46","daysAgo":89,"time":"14:00","merchant":"Albert Heijn","desc":"AH DEMO 0001","cat":"groceries","amountCents":-4930,"account":"demo_main"},
  {"id":"dm47","daysAgo":82,"time":"12:00","merchant":"Jumbo","desc":"JUMBO DEMO 0042","cat":"groceries","amountCents":-5870,"account":"demo_main"},
  {"id":"dm48","daysAgo":75,"time":"17:00","merchant":"Albert Heijn","desc":"AH DEMO 0001","cat":"groceries","amountCents":-5340,"account":"demo_main"},
  {"id":"dm49","daysAgo":69,"time":"10:00","merchant":"Lidl","desc":"LIDL DEMO","cat":"groceries","amountCents":-2980,"account":"demo_main"},
  {"id":"dm50","daysAgo":87,"time":"09:00","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-450,"account":"demo_main"},
  {"id":"dm51","daysAgo":80,"time":"08:30","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-380,"account":"demo_main"},
  {"id":"dm52","daysAgo":73,"time":"09:00","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-450,"account":"demo_main"},
  {"id":"dm53","daysAgo":85,"time":"19:30","merchant":"Demo Restaurant","desc":"DEMO RESTAURANT AMS","cat":"restaurants","amountCents":-3250,"account":"demo_main"},
  {"id":"dm54","daysAgo":71,"time":"21:00","merchant":"Demo Restaurant","desc":"DEMO PIZZA PLACE","cat":"restaurants","amountCents":-2850,"account":"demo_main"},
  {"id":"dm55","daysAgo":88,"time":"15:30","merchant":"NS · Sprinter","desc":"NS DEMO REIZIGERS","cat":"transportPublic","amountCents":-1580,"account":"demo_main"},
  {"id":"dm56","daysAgo":76,"time":"13:00","merchant":"GVB","desc":"GVB DEMO OV","cat":"transportPublic","amountCents":-360,"account":"demo_main"},
  {"id":"dm57","daysAgo":78,"time":"11:00","merchant":"Kruidvat","desc":"KRUIDVAT DEMO","cat":"healthcare","amountCents":-1280,"account":"demo_main"},
  {"id":"dm58","daysAgo":68,"time":"09:00","merchant":"Savings transfer","desc":"DEMO SPAAROVERBOEKING","cat":"savingDeposit","amountCents":-25000,"account":"demo_main"},
  {"id":"dm59","daysAgo":56,"time":"08:00","merchant":"Demo Corp BV","desc":"DEMO CORP BV SALARIS APR","cat":"salary","amountCents":220000,"account":"demo_main"},
  {"id":"dm60","daysAgo":54,"time":"00:00","merchant":"Demo Verhuur","desc":"DEMO VERHUUR HUUR APR","cat":"housingRent","amountCents":-85000,"account":"demo_main"},
  {"id":"dm61","daysAgo":51,"time":"07:00","merchant":"Eneco","desc":"ENECO ENERGIE APR","cat":"housingUtility","amountCents":-5800,"account":"demo_main"},
  {"id":"dm62","daysAgo":49,"time":"09:00","merchant":"Spotify","desc":"SPOTIFY SUBSCR APR","cat":"subs","amountCents":-999,"account":"demo_main"},
  {"id":"dm63","daysAgo":47,"time":"09:00","merchant":"Netflix","desc":"NETFLIX SUBSCR APR","cat":"subs","amountCents":-1399,"account":"demo_main"},
  {"id":"dm64","daysAgo":59,"time":"13:00","merchant":"Albert Heijn","desc":"AH DEMO 0001","cat":"groceries","amountCents":-6320,"account":"demo_main"},
  {"id":"dm65","daysAgo":52,"time":"11:30","merchant":"Jumbo","desc":"JUMBO DEMO 0042","cat":"groceries","amountCents":-4180,"account":"demo_main"},
  {"id":"dm66","daysAgo":45,"time":"17:00","merchant":"Albert Heijn","desc":"AH DEMO 0001","cat":"groceries","amountCents":-5530,"account":"demo_main"},
  {"id":"dm67","daysAgo":38,"time":"10:00","merchant":"Lidl","desc":"LIDL DEMO","cat":"groceries","amountCents":-3460,"account":"demo_main"},
  {"id":"dm68","daysAgo":57,"time":"09:00","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-450,"account":"demo_main"},
  {"id":"dm69","daysAgo":50,"time":"08:30","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-380,"account":"demo_main"},
  {"id":"dm70","daysAgo":43,"time":"09:00","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-450,"account":"demo_main"},
  {"id":"dm71","daysAgo":55,"time":"20:00","merchant":"Demo Restaurant","desc":"DEMO RESTAURANT AMS","cat":"restaurants","amountCents":-5200,"account":"demo_main"},
  {"id":"dm72","daysAgo":41,"time":"19:00","merchant":"Demo Restaurant","desc":"DEMO PIZZA PLACE","cat":"restaurants","amountCents":-2490,"account":"demo_main"},
  {"id":"dm73","daysAgo":58,"time":"14:00","merchant":"NS · Sprinter","desc":"NS DEMO REIZIGERS","cat":"transportPublic","amountCents":-2460,"account":"demo_main"},
  {"id":"dm74","daysAgo":44,"time":"16:00","merchant":"NS · Sprinter","desc":"NS DEMO REIZIGERS","cat":"transportPublic","amountCents":-1880,"account":"demo_main"},
  {"id":"dm75","daysAgo":48,"time":"14:00","merchant":"Etos","desc":"ETOS DEMO","cat":"healthcare","amountCents":-2240,"account":"demo_main"},
  {"id":"dm76","daysAgo":39,"time":"09:00","merchant":"Savings transfer","desc":"DEMO SPAAROVERBOEKING","cat":"savingDeposit","amountCents":-30000,"account":"demo_main"},
  {"id":"dm77","daysAgo":46,"time":"12:00","merchant":"Bol.com","desc":"BOL.COM DEMO ORDER","cat":"hobby","amountCents":-3499,"account":"demo_main","needsReview":true,"confidence":65},
  {"id":"dm78","daysAgo":32,"time":"08:00","merchant":"Demo Corp BV","desc":"DEMO CORP BV SALARIS MEI","cat":"salary","amountCents":220000,"account":"demo_main"},
  {"id":"dm79","daysAgo":33,"time":"00:00","merchant":"Demo Verhuur","desc":"DEMO VERHUUR HUUR MEI","cat":"housingRent","amountCents":-85000,"account":"demo_main"},
  {"id":"dm80","daysAgo":31,"time":"07:00","merchant":"Eneco","desc":"ENECO ENERGIE MEI","cat":"housingUtility","amountCents":-5500,"account":"demo_main"},
  {"id":"dm81","daysAgo":19,"time":"09:00","merchant":"Spotify","desc":"SPOTIFY SUBSCR MEI","cat":"subs","amountCents":-999,"account":"demo_main"},
  {"id":"dm82","daysAgo":17,"time":"09:00","merchant":"Netflix","desc":"NETFLIX SUBSCR MEI","cat":"subs","amountCents":-1399,"account":"demo_main"},
  {"id":"dm83","daysAgo":29,"time":"13:00","merchant":"Albert Heijn","desc":"AH DEMO 0001","cat":"groceries","amountCents":-4760,"account":"demo_main"},
  {"id":"dm84","daysAgo":22,"time":"11:00","merchant":"Jumbo","desc":"JUMBO DEMO 0042","cat":"groceries","amountCents":-6230,"account":"demo_main"},
  {"id":"dm85","daysAgo":15,"time":"16:30","merchant":"Albert Heijn","desc":"AH DEMO 0001","cat":"groceries","amountCents":-3890,"account":"demo_main"},
  {"id":"dm86","daysAgo":8,"time":"10:00","merchant":"Lidl","desc":"LIDL DEMO","cat":"groceries","amountCents":-2740,"account":"demo_main"},
  {"id":"dm87","daysAgo":27,"time":"09:00","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-450,"account":"demo_main"},
  {"id":"dm88","daysAgo":20,"time":"08:30","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-380,"account":"demo_main"},
  {"id":"dm89","daysAgo":13,"time":"09:00","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-450,"account":"demo_main"},
  {"id":"dm90","daysAgo":6,"time":"08:30","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-380,"account":"demo_main"},
  {"id":"dm91","daysAgo":25,"time":"20:00","merchant":"Demo Restaurant","desc":"DEMO RESTAURANT AMS","cat":"restaurants","amountCents":-4150,"account":"demo_main"},
  {"id":"dm92","daysAgo":11,"time":"19:30","merchant":"Demo Restaurant","desc":"DEMO SUSHI PLACE","cat":"restaurants","amountCents":-2900,"account":"demo_main"},
  {"id":"dm93","daysAgo":4,"time":"20:30","merchant":"Demo Restaurant","desc":"DEMO RESTAURANT AMS","cat":"restaurants","amountCents":-3400,"account":"demo_main"},
  {"id":"dm94","daysAgo":28,"time":"14:30","merchant":"NS · Sprinter","desc":"NS DEMO REIZIGERS","cat":"transportPublic","amountCents":-2820,"account":"demo_main"},
  {"id":"dm95","daysAgo":14,"time":"15:00","merchant":"NS · Sprinter","desc":"NS DEMO REIZIGERS","cat":"transportPublic","amountCents":-1440,"account":"demo_main"},
  {"id":"dm96","daysAgo":23,"time":"11:00","merchant":"Kruidvat","desc":"KRUIDVAT DEMO","cat":"healthcare","amountCents":-1690,"account":"demo_main"},
  {"id":"dm97","daysAgo":16,"time":"09:00","merchant":"Etos","desc":"ETOS DEMO","cat":"healthcare","amountCents":-2450,"account":"demo_main"},
  {"id":"dm98","daysAgo":9,"time":"09:00","merchant":"Savings transfer","desc":"DEMO SPAAROVERBOEKING","cat":"savingDeposit","amountCents":-20000,"account":"demo_main"},
  {"id":"dm99","daysAgo":12,"time":"12:00","merchant":"H&M Nederland","desc":"HM DEMO NETHERLANDS","cat":"clothing","amountCents":-4999,"account":"demo_main","needsReview":true,"confidence":70},
  {"id":"dm100","daysAgo":3,"time":"14:00","merchant":"Amazon.nl","desc":"AMZN DEMO MKTPLC","cat":"hobby","amountCents":-2899,"account":"demo_main","needsReview":true,"confidence":60},
  // always-today activity: keeps the demo alive and the current budget period non-empty on any date
  {"id":"dm101","daysAgo":1,"time":"18:10","merchant":"Albert Heijn","desc":"AH DEMO 0001","cat":"groceries","amountCents":-2310,"account":"demo_main"},
  {"id":"dm102","daysAgo":0,"time":"08:40","merchant":"Koffie ☕","desc":"DEMO COFFEE BAR","cat":"coffee","amountCents":-420,"account":"demo_main"},
];
