// One-shot port of apollousa's category keyword predictor data to TS.
// Usage: node scripts/port-keywords.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(
  here,
  '../../../temporary/apollousa-feature-sql-okkes/Apollousa.Application/CategoryPredictor/Data',
);
const out = path.resolve(here, '../src/domain/keyword-categories.ts');

// CategoryEnum name -> our catalog id (apps/web/src/domain/categories.ts)
const ENUM_TO_ID = {
  ConsumptionAlcoholAndTobacco: 'alcohol',
  ConsumptionBreakfastAndBrunch: 'breakfast',
  ConsumptionCoffee: 'coffee',
  ConsumptionDiningOut: 'restaurants',
  ConsumptionGrocery: 'groceries',
  ConsumptionSweetsAndTreats: 'sweets',
  ConsumptionTakeoutAndDelivery: 'takeout',
  DefaultExpenseUncategorized: 'uncategorized',
  DefaultIncomeFreelanceWork: 'freelance',
  DefaultIncomeInvestmentIncome: 'investIncome',
  DefaultIncomeReimbursement: 'reimburse',
  DefaultIncomeRental: 'rental',
  DefaultIncomeSalary: 'salary',
  EducationBook: 'book',
  EducationCertificate: 'certificate',
  EducationCourse: 'course',
  EducationNewspaper: 'newspaper',
  EducationSchoolSupply: 'schoolSupply',
  EducationTuition: 'tuition',
  EntertainmentConcertsAndShows: 'concerts',
  EntertainmentDating: 'dating',
  EntertainmentGambling: 'gambling',
  EntertainmentHobby: 'hobby',
  EntertainmentMovie: 'movie',
  EntertainmentOther: 'entertainmentOther',
  EntertainmentSportingEvent: 'sportingEvent',
  EntertainmentStreamingService: 'subs',
  EntertainmentVideoGame: 'videoGame',
  ExtraBirthday: 'birthday',
  ExtraCashWithdraw: 'cashWithdraw',
  ExtraCharity: 'charity',
  ExtraFamilyCare: 'familyCare',
  ExtraFee: 'fee',
  ExtraFines: 'fines',
  ExtraFuneralInsurance: 'funeralInsurance',
  ExtraTaxes: 'taxes',
  HealthcareDentalWork: 'dental',
  HealthcareDoctorVisit: 'doctorVisit',
  HealthcareHealthInsurance: 'healthInsurance',
  HealthcareHealthUtility: 'healthUtility',
  HealthcareMentalCare: 'mentalCare',
  HealthcarePrescription: 'prescription',
  HolidayActivity: 'activity',
  HolidayCarRental: 'carRental',
  HolidayFlight: 'flight',
  HolidayHotelAndAirbnb: 'hotel',
  HousingMaintenanceAndRepair: 'housingMaintenance',
  HousingRentAndMortgage: 'housingRent',
  HousingStorageArea: 'housingStorage',
  HousingUtility: 'housingUtility',
  PersonalCareHaircut: 'haircut',
  PersonalCareHealthAndBeautyProduct: 'beautyProduct',
  PersonalCareToiletry: 'toiletry',
  PetPetFood: 'petFood',
  PetPetInsurance: 'petInsurance',
  PetPetSupply: 'petSupply',
  ShoppingChildCare: 'childCare',
  ShoppingClothing: 'clothing',
  ShoppingElectronic: 'electronics',
  ShoppingFestivity: 'festivity',
  ShoppingGift: 'gift',
  ShoppingHomeAutomation: 'homeAutomation',
  ShoppingHomeGoods: 'homeGoods',
  ShoppingHouseGarden: 'houseGarden',
  ShoppingIntimateUtility: 'intimateUtility',
  ShoppingOther: 'shoppingOther',
  SportGymMembership: 'gym',
  SportSportsEquipment: 'sportsEquipment',
  TransportationCarPayment: 'transportCar',
  TransportationGasAndFuel: 'transportFuel',
  TransportationPublicTransportation: 'transportPublic',
};

const FILES = {
  nl: 'DutchCategoryKeyWordsMapping.cs',
  en: 'EnglishCategoryKeyWordsMapping.cs',
  tr: 'TurkishCategoryKeyWordsMapping.cs',
};

// validate ids against the generated catalog
const catalogSrc = readFileSync(path.resolve(here, '../src/domain/categories.ts'), 'utf8');
for (const id of Object.values(ENUM_TO_ID)) {
  if (!catalogSrc.includes(`"id":"${id}"`)) throw new Error(`catalog id not found: ${id}`);
}

const rules = [];
for (const [lang, file] of Object.entries(FILES)) {
  const src = readFileSync(path.join(dataDir, file), 'utf8');
  const blockRe =
    /CategoryEnum\.(\w+)\][\s\S]*?KeyWords = new string\[\]\s*\{([\s\S]*?)\}/g;
  let m;
  let count = 0;
  while ((m = blockRe.exec(src))) {
    const enumName = m[1];
    const catId = ENUM_TO_ID[enumName];
    if (!catId) throw new Error(`unmapped enum: ${enumName} in ${file}`);
    const keywords = [...m[2].matchAll(/"([^"]+)"/g)].map((k) => k[1].toLowerCase());
    if (keywords.length) {
      rules.push({ lang, catId, keywords });
      count++;
    }
  }
  console.log(`${lang}: ${count} rules`);
}

writeFileSync(
  out,
  `// GENERATED from apollousa CategoryPredictor keyword data by scripts/port-keywords.mjs.
export interface KeywordRule {
  lang: 'nl' | 'en' | 'tr';
  catId: string;
  keywords: string[];
}

export const KEYWORD_RULES: KeywordRule[] = [
${rules.map((r) => `  ${JSON.stringify(r)},`).join('\n')}
];
`,
);
console.log(`written ${rules.length} rules to ${out}`);

// Also emit the server-side variant (embedded resource) with direction +
// txType resolved from the catalog, so GoCardless ingestion categorizes
// identically to client-side CAMT import.
const catalog = new Map(
  catalogSrc
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter((line) => line.startsWith('{"id":'))
    .map((line) => JSON.parse(line))
    .map((c) => [c.id, c]),
);
const serverRules = rules.map((r) => {
  const cat = catalog.get(r.catId);
  return { ...r, direction: cat.direction, txType: cat.txTypes[0] ?? 'expense' };
});
const serverOut = path.resolve(here, '../../../server/src/Munni.Api/GoCardless/keyword-rules.json');
writeFileSync(serverOut, JSON.stringify(serverRules, null, 1));
console.log(`written ${serverRules.length} server rules to ${serverOut}`);
