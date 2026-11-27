// Editable food-market demo taxonomy and products for Sarichain.
export const demoBrands = [
  ['bagh-sabz', 'باغ سبز دماوند', 'apple'],
  ['sepid-dasht', 'دامداری سپیددشت', 'milk'],
  ['shomal-daneh', 'دانه‌زار شمال', 'rice'],
  ['koohestan', 'عسل کوهستان', 'honey'],
] as const;

// [slug key, display name, parent key, representative image key]
export const demoCategories = [
  // Eight top-level categories
  ['fresh-produce', 'میوه و سبزیجات', null, 'apple'],
  ['protein', 'گوشت، مرغ، ماهی و تخم‌مرغ', null, 'meat'],
  ['dairy', 'لبنیات', null, 'milk'],
  ['legumes-grains', 'حبوبات و غلات', null, 'rice'],
  ['spices-herbs', 'ادویه‌جات و گیاهان معطر', null, 'spice'],
  ['nuts-seeds', 'خشکبار، مغزها و دانه‌ها', null, 'nuts'],
  ['oils-natural', 'روغن‌ها، عسل و فرآورده‌های طبیعی', null, 'honey'],
  ['processed-local', 'محصولات فرآوری‌شده، محلی و نوشیدنی‌ها', null, 'jam'],

  // Level two
  ['fresh-fruit', 'میوه تازه', 'fresh-produce', 'apple'],
  ['vegetables', 'سبزیجات و صیفی‌جات', 'fresh-produce', 'vegetable'],
  ['fresh-herbs', 'سبزی خوردن و گیاهان تازه', 'fresh-produce', 'herbs'],
  ['mushrooms', 'قارچ و محصولات گلخانه‌ای', 'fresh-produce', 'mushroom'],
  ['red-meat', 'گوشت قرمز', 'protein', 'meat'],
  ['poultry', 'مرغ و طیور', 'protein', 'chicken'],
  ['fish-seafood', 'ماهی و آبزیان', 'protein', 'fish'],
  ['eggs', 'تخم‌مرغ', 'protein', 'eggs'],
  ['milk-cream', 'شیر و خامه', 'dairy', 'milk'],
  ['yogurt-doogh', 'ماست و دوغ', 'dairy', 'yogurt'],
  ['cheese-butter', 'پنیر و کره', 'dairy', 'cheese'],
  ['legumes', 'حبوبات', 'legumes-grains', 'beans'],
  ['rice', 'برنج', 'legumes-grains', 'rice'],
  ['grains-flour', 'غلات و آرد', 'legumes-grains', 'grain'],
  ['spices', 'ادویه‌جات', 'spices-herbs', 'spice'],
  ['aromatic-herbs', 'گیاهان معطر و سبزی خشک', 'spices-herbs', 'herbs'],
  ['medicinal-herbs', 'گیاهان دارویی خوراکی', 'spices-herbs', 'medicinal'],
  ['nuts', 'مغزها و آجیل', 'nuts-seeds', 'nuts'],
  ['dried-fruit', 'میوه خشک و خشکبار', 'nuts-seeds', 'raisins'],
  ['edible-seeds', 'دانه‌های خوراکی', 'nuts-seeds', 'seeds'],
  ['edible-oils', 'روغن‌های خوراکی', 'oils-natural', 'oil'],
  ['honey-bee', 'عسل و فرآورده‌های زنبورداری', 'oils-natural', 'honey'],
  ['natural-syrups', 'شیره‌ها و فرآورده‌های طبیعی', 'oils-natural', 'syrup'],
  ['pickles-preserves', 'ترشی، شور و کنسرویجات', 'processed-local', 'pickle'],
  ['jams-pastes', 'مربا، رب و چاشنی‌ها', 'processed-local', 'jam'],
  ['dried-processed', 'محصولات خشک و فرآوری‌شده', 'processed-local', 'dried'],
  ['beverages', 'نوشیدنی‌ها و عرقیات', 'processed-local', 'drink'],

  // Level three: focused browse groups
  ['citrus', 'مرکبات', 'fresh-fruit', 'orange'],
  ['apples-pears', 'سیب و گلابی', 'fresh-fruit', 'apple'],
  ['stone-fruit', 'میوه‌های هسته‌دار', 'fresh-fruit', 'peach'],
  ['leafy-vegetables', 'سبزیجات برگی', 'vegetables', 'leafy'],
  ['root-vegetables', 'سبزیجات ریشه‌ای', 'vegetables', 'carrot'],
  ['tomato-cucumber', 'گوجه و خیار', 'vegetables', 'tomato'],
  ['lamb-beef', 'گوشت گوسفند و گاو', 'red-meat', 'meat'],
  ['chicken-turkey', 'مرغ و بوقلمون', 'poultry', 'chicken'],
  ['freshwater-fish', 'ماهی پرورشی و آب شیرین', 'fish-seafood', 'fish'],
  ['lentils-beans', 'عدس و انواع لوبیا', 'legumes', 'beans'],
  ['chickpeas-peas', 'نخود و لپه', 'legumes', 'chickpea'],
  ['saffron-pepper', 'زعفران و فلفل', 'spices', 'saffron'],
  ['walnut-almond', 'گردو و بادام', 'nuts', 'walnut'],
  ['pistachio-hazelnut', 'پسته و فندق', 'nuts', 'pistachio'],
] as const;

// Fictional demo producers; city-centre coordinates are approximate test points.
export const demoProducers = [
['p01','علی رضایی','باغ مرکبات نارنجستان','orchard','باغداری مرکبات و میوه فصلی','ساری','348',36.5659,53.0586,'orchard'],
['p02','مریم کریمی','باغ سیب دشت‌سبز','orchard','تولید سیب، گلابی و میوه هسته‌دار','بابل','342',36.5387,52.6765,'orchard'],
['p03','حسین محمدی','باغ کیوی ساحل‌سبز','orchard','تولید کیوی و مرکبات','نوشهر','336',36.6489,51.4962,'orchard'],
['p04','رضا احمدی','باغ میوه کوهپایه','orchard','باغداری هلو، شلیل و مرکبات','بهشهر','341',36.6923,53.5526,'orchard'],
['p05','زهرا موسوی','مزرعه سبزینه شمال','farm','کشت سبزی و صیفی','آمل','339',36.4696,52.3507,'vegetable'],
['p06','محمد جعفری','کشتزار دشت هراز','farm','تولید برنج و غلات','آمل','339',36.4708,52.3541,'rice'],
['p07','فاطمه حیدری','مزرعه حبوبات البرز','farm','تولید حبوبات و دانه خوراکی','قائم شهر','332',36.4631,52.8604,'legumes'],
['p08','مهدی اکبری','مزرعه طلوع جویبار','farm','کشت سبزیجات فصلی','جویبار','345',36.6415,52.9117,'vegetable'],
['p09','نرگس صادقی','مزرعه برنج شالیزار','farm','کشت برنج طارم و غلات','بابلسر','343',36.7025,52.6574,'rice'],
['p10','امیرحسین قاسمی','گلخانه بهار بابل','greenhouse','تولید خیار و گوجه گلخانه‌ای','بابل','342',36.5412,52.6812,'vegetable'],
['p11','سمیه رحمانی','گلخانه سبزآوران','greenhouse','تولید سبزی و صیفی گلخانه‌ای','ساری','348',36.5701,53.0631,'vegetable'],
['p12','اکبر نوری','گلخانه هیرکانی','greenhouse','تولید فلفل و محصولات گلخانه‌ای','نکا','334',36.6508,53.2990,'vegetable'],
['p13','مجید رستمی','دامداری سپیددشت','dairy','تولید شیر و لبنیات','قائم شهر','332',36.4660,52.8640,'dairy'],
['p14','لیلا شریفی','دامداری دشت شیر','dairy','پرورش دام شیری','آمل','339',36.4730,52.3590,'dairy'],
['p15','یوسف مرادی','لبنیات محلی کوهستان','dairy','تولید پنیر و لبنیات سنتی','سوادکوه','347',36.3002,52.8867,'dairy'],
['p16','کریم عباسی','مرغداری سبزپر','other','پرورش طیور و تولید تخم‌مرغ','بهشهر','341',36.6960,53.5580,'poultry'],
['p17','پروانه اسدی','پرورش ماهی چشمه‌سار','other','پرورش ماهی قزل‌آلا','تنکابن','344',36.8163,50.8738,'fish'],
['p18','داوود قنبری','زنبورستان عسل کوهستان','other','زنبورداری و تولید عسل','رامسر','346',36.9030,50.6586,'honey'],
['p19','شبنم یوسفی','باغ خشکبار هراز','other','تولید گردو و خشکبار','نور','335',36.5745,52.0150,'nuts'],
['p20','فرهاد زمانی','کارگاه فرآورده‌های بومی','other','فرآوری محصولات محلی و گیاهان معطر','چالوس','337',36.6550,51.4204,'herbs'],
] as const;

const productSets = {
orchard: [
['سیب قرمز','apples-pears',78000,'کیلوگرم','برداشت تازه باغی','فله','apple'],['سیب زرد','apples-pears',82000,'کیلوگرم','درجه یک و سورت‌شده','سبد','apple'],['پرتقال تامسون','citrus',65000,'کیلوگرم','آبدار و تازه‌بار','فله','orange'],['نارنگی','citrus',72000,'کیلوگرم','شیرین و پوست‌نازک','سبد','orange'],['لیموترش','citrus',95000,'کیلوگرم','تازه و پرآب','سبد','lemon'],['کیوی','stone-fruit',110000,'کیلوگرم','سورت‌شده','کارتن','kiwi'],['گلابی','apples-pears',125000,'کیلوگرم','رسیده و خوش‌عطر','سبد','pear'],['هلو','stone-fruit',98000,'کیلوگرم','باغی و خوش‌رنگ','سبد','peach'],['شلیل','stone-fruit',105000,'کیلوگرم','درجه یک','سبد','peach'],['آلو زرد','stone-fruit',90000,'کیلوگرم','تازه‌چین','سبد','plum']],
vegetable: [
['خیار گلخانه‌ای','tomato-cucumber',42000,'کیلوگرم','یکدست و تازه','سبد','cucumber'],['گوجه‌فرنگی بوته‌ای','tomato-cucumber',52000,'کیلوگرم','رسیده و سفت','سبد','tomato'],['فلفل دلمه‌ای','vegetables',88000,'کیلوگرم','رنگی و گلخانه‌ای','سبد','pepper'],['بادمجان قلمی','vegetables',48000,'کیلوگرم','پوست براق و تازه','سبد','eggplant'],['کدو سبز','vegetables',45000,'کیلوگرم','تازه‌چین','سبد','zucchini'],['هویج','root-vegetables',39000,'کیلوگرم','سورت‌شده','کیسه','carrot'],['کاهو رسمی','leafy-vegetables',32000,'عدد','برگ ترد و تازه','عددی','lettuce'],['کلم سفید','vegetables',36000,'کیلوگرم','تازه و سفت','سبد','cabbage'],['اسفناج','leafy-vegetables',55000,'کیلوگرم','برگ تازه','دسته‌ای','spinach'],['لوبیا سبز','vegetables',95000,'کیلوگرم','پاک‌شده و تازه','سبد','beans']],
rice: [
['برنج طارم محلی','rice',185000,'کیلوگرم','معطر و محصول شالیزار','کیسه ۱۰ کیلویی','rice'],['برنج هاشمی','rice',198000,'کیلوگرم','دانه بلند و خوش‌پخت','کیسه ۱۰ کیلویی','rice'],['برنج شیرودی','rice',145000,'کیلوگرم','مناسب مصرف روزانه','کیسه ۱۰ کیلویی','rice'],['برنج فجر','rice',155000,'کیلوگرم','یکدست و خوش‌پخت','کیسه ۱۰ کیلویی','rice'],['برنج نیم‌دانه','rice',98000,'کیلوگرم','مناسب آش و شیر برنج','کیسه','rice'],['آرد برنج','grains-flour',125000,'کیلوگرم','آسیاب تازه','بسته','flour'],['جو پرک','grains-flour',85000,'کیلوگرم','پاک‌شده','بسته','grain'],['گندم کامل','grains-flour',62000,'کیلوگرم','برداشت جدید','کیسه','grain'],['سبوس برنج','grains-flour',48000,'کیلوگرم','تازه و تمیز','کیسه','grain'],['شلتوک برنج','rice',35000,'کیلوگرم','محصول شالیزار','کیسه','rice']],
legumes: [
['لوبیا چیتی','lentils-beans',175000,'کیلوگرم','دستچین و یکدست','کیسه','beans'],['لوبیا قرمز','lentils-beans',168000,'کیلوگرم','پاک‌شده','کیسه','beans'],['لوبیا سفید','lentils-beans',182000,'کیلوگرم','درشت و تازه‌بار','کیسه','beans'],['عدس سبز','lentils-beans',138000,'کیلوگرم','یکدست و پاک‌شده','کیسه','lentils'],['نخود','chickpeas-peas',148000,'کیلوگرم','درشت و تازه‌بار','کیسه','chickpeas'],['لپه','chickpeas-peas',165000,'کیلوگرم','زرد و یکدست','کیسه','peas'],['ماش','lentils-beans',125000,'کیلوگرم','پاک‌شده','کیسه','beans'],['باقلا خشک','lentils-beans',135000,'کیلوگرم','محصول محلی','کیسه','beans'],['تخمه آفتابگردان','edible-seeds',128000,'کیلوگرم','خام و تمیز','کیسه','seeds'],['کنجد سفید','edible-seeds',195000,'کیلوگرم','خالص و پاک‌شده','کیسه','seeds']],
dairy: [
['شیر گاو تازه','milk-cream',48000,'لیتر','تولید روز و نیازمند زنجیره سرد','بطری','milk'],['شیر پرچرب','milk-cream',58000,'لیتر','پرچرب و تازه','بطری','milk'],['ماست سنتی','yogurt-doogh',98000,'کیلوگرم','از شیر تازه','ظرف','yogurt'],['ماست چکیده','yogurt-doogh',165000,'کیلوگرم','پرچرب و غلیظ','ظرف','yogurt'],['دوغ محلی','yogurt-doogh',42000,'لیتر','بدون گاز و خنک','بطری','yogurt'],['پنیر تازه','cheese-butter',245000,'کیلوگرم','تهیه روزانه','ظرف','cheese'],['پنیر لیقوان محلی','cheese-butter',320000,'کیلوگرم','رسیده در آب‌نمک','ظرف','cheese'],['کره محلی','cheese-butter',560000,'کیلوگرم','از خامه تازه','بسته','butter'],['خامه صبحانه','milk-cream',210000,'کیلوگرم','تازه و پرچرب','ظرف','cream'],['کشک محلی','cheese-butter',185000,'کیلوگرم','سنتی و غلیظ','ظرف','cheese']],
poultry: [
['مرغ کامل تازه','chicken-turkey',118000,'کیلوگرم','کشتار روز و بسته‌بندی بهداشتی','بسته','chicken'],['ران مرغ','chicken-turkey',145000,'کیلوگرم','تازه و پاک‌شده','بسته','chicken'],['سینه مرغ','chicken-turkey',185000,'کیلوگرم','بدون استخوان','بسته','chicken'],['بال مرغ','chicken-turkey',135000,'کیلوگرم','تازه و پاک‌شده','بسته','chicken'],['تخم‌مرغ محلی','eggs',145000,'شانه','تولید روز مرغداری','شانه ۳۰ عددی','eggs'],['تخم‌مرغ بسته‌بندی','eggs',158000,'شانه','درجه‌بندی‌شده','شانه','eggs'],['بوقلمون','chicken-turkey',265000,'کیلوگرم','پرورش محلی','بسته','chicken'],['بلدرچین','chicken-turkey',320000,'کیلوگرم','پرورشی و تازه','بسته','chicken'],['دل و جگر مرغ','chicken-turkey',98000,'کیلوگرم','تازه و پاک‌شده','بسته','chicken'],['مرغ محلی','chicken-turkey',245000,'کیلوگرم','پرورش آزاد','بسته','chicken']],
fish: [
['قزل‌آلای تازه','freshwater-fish',285000,'کیلوگرم','پرورش کنترل‌شده','یخچالی','fish'],['قزل‌آلای شکم‌خالی','freshwater-fish',325000,'کیلوگرم','پاک‌شده و آماده طبخ','یخچالی','fish'],['ماهی کپور','fish-seafood',210000,'کیلوگرم','پرورشی و تازه','یخچالی','fish'],['ماهی سفید','fish-seafood',420000,'کیلوگرم','صید روز و فصلی','یخچالی','fish'],['ماهی کفال','fish-seafood',245000,'کیلوگرم','تازه و محلی','یخچالی','fish'],['فیله قزل‌آلا','freshwater-fish',460000,'کیلوگرم','بدون تیغ','بسته','fish'],['میگوی پرورشی','fish-seafood',520000,'کیلوگرم','پاک‌شده','یخچالی','shrimp'],['ماهی آمور','fish-seafood',235000,'کیلوگرم','پرورشی','یخچالی','fish'],['ماهی کپور درشت','fish-seafood',225000,'کیلوگرم','تازه و درجه یک','یخچالی','fish'],['ماهی دودی محلی','dried-processed',390000,'کیلوگرم','دودی سنتی','بسته','fish']],
honey: [
['عسل چندگیاه','honey-bee',560000,'کیلوگرم','برداشت زنبورستان کوهستانی','ظرف','honey'],['عسل بهارنارنج','honey-bee',680000,'کیلوگرم','تک‌گل و معطر','ظرف','honey'],['عسل جنگلی','honey-bee',720000,'کیلوگرم','برداشت محدود جنگلی','ظرف','honey'],['موم زنبورعسل','honey-bee',850000,'کیلوگرم','خام و طبیعی','بسته','honey'],['گرده گل','honey-bee',950000,'کیلوگرم','خشک و پاک‌شده','ظرف','honey'],['بره‌موم','honey-bee',950000,'کیلوگرم','خام زنبورداری','ظرف','honey'],['عسل مرکبات','honey-bee',620000,'کیلوگرم','برداشت فصل بهار','ظرف','honey'],['عسل کوهستان','honey-bee',590000,'کیلوگرم','چندگیاه و طبیعی','ظرف','honey'],['شیره انگور','natural-syrups',195000,'کیلوگرم','تهیه سنتی','ظرف','syrup'],['شیره خرمالو','natural-syrups',220000,'کیلوگرم','محلی و بدون افزودنی','ظرف','syrup']],
nuts: [
['گردوی پوست‌کاغذی','walnut-almond',450000,'کیلوگرم','مغز روشن و تازه','کیسه','walnut'],['مغز گردو','walnut-almond',820000,'کیلوگرم','دستچین و سالم','بسته','walnut'],['فندق خام','pistachio-hazelnut',690000,'کیلوگرم','محصول باغی','کیسه','nuts'],['بادام درختی','walnut-almond',780000,'کیلوگرم','خام و دستچین','کیسه','nuts'],['پسته خام','pistachio-hazelnut',900000,'کیلوگرم','درجه یک','کیسه','pistachio'],['آلو خشک','dried-fruit',250000,'کیلوگرم','خشک‌شده طبیعی','بسته','dried'],['کشمش آفتابی','dried-fruit',185000,'کیلوگرم','بدون افزودنی','بسته','raisins'],['انجیر خشک','dried-fruit',380000,'کیلوگرم','درجه یک','بسته','dried'],['تخمه کدو','edible-seeds',245000,'کیلوگرم','خام و پاک‌شده','بسته','seeds'],['بادام‌زمینی','nuts',220000,'کیلوگرم','خام و تازه','کیسه','nuts']],
herbs: [
['نعناع خشک','aromatic-herbs',340000,'کیلوگرم','خشک‌شده در سایه','بسته','herbs'],['سبزی قورمه خشک','aromatic-herbs',390000,'کیلوگرم','ترکیب سبزی محلی','بسته','herbs'],['گل‌گاوزبان','medicinal-herbs',950000,'کیلوگرم','خشک و پاک‌شده','بسته','herbs'],['بابونه خشک','medicinal-herbs',620000,'کیلوگرم','گل کامل خشک‌شده','بسته','herbs'],['آویشن کوهی','medicinal-herbs',480000,'کیلوگرم','معطر و پاک‌شده','بسته','herbs'],['عرق نعناع','beverages',72000,'لیتر','عرق‌گیری سنتی','بطری','drink'],['عرق بهارنارنج','beverages',98000,'لیتر','تقطیر سنتی','بطری','drink'],['ترشی سیر محلی','pickles-preserves',185000,'کیلوگرم','رسیده و خانگی','ظرف','pickles'],['مربای به','jams-pastes',210000,'کیلوگرم','پخت محدود محلی','ظرف','jam'],['رب انار ترش','jams-pastes',245000,'کیلوگرم','از انار تازه','ظرف','jam']]
} as const;

export const demoProducts = demoProducers.flatMap((producer, producerIndex) => {
  const organization = producer[2], city = producer[5], group = producer[9];
  const sellerProducts = productSets[group].flatMap(item => [
    item,
    [item[0] + ' درجه ممتاز', item[1], Math.round(item[2] * 1.12 / 1000) * 1000,
      item[3], item[4] + '؛ سورت ممتاز', 'بسته ممتاز', item[6]] as const,
  ]);
  return sellerProducts.map((item, index) => {
    const code = String(3001 + producerIndex * 20 + index);
    const price = Math.round(item[2] * (0.96 + (producerIndex % 7) * 0.015) / 1000) * 1000;
    return [code, item[0] + ' · ' + organization, item[1], price, item[3], item[4] + '؛ تولید ' + city, item[5], item[6], producerIndex] as const;
  });
});

export const demoImageUrls: Record<string, string> = {
apple:'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=1000&q=85',
orange:'https://images.unsplash.com/photo-1547514701-42782101795e?auto=format&fit=crop&w=1000&q=85',
lemon:'https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=1000&q=85',
kiwi:'https://images.unsplash.com/photo-1585059895524-72359e06133a?auto=format&fit=crop&w=1000&q=85',
pear:'https://images.unsplash.com/photo-1514756331096-6f3e2e7d3c2a?auto=format&fit=crop&w=1000&q=85',
peach:'https://images.unsplash.com/photo-1629828874514-c1e5103a8b10?auto=format&fit=crop&w=1000&q=85',
plum:'https://images.unsplash.com/photo-1595743825637-cdafc8ad4173?auto=format&fit=crop&w=1000&q=85',
cucumber:'https://images.unsplash.com/photo-1604977042946-1eecc30f269e?auto=format&fit=crop&w=1000&q=85',
tomato:'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?auto=format&fit=crop&w=1000&q=85',
pepper:'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?auto=format&fit=crop&w=1000&q=85',
eggplant:'https://images.unsplash.com/photo-1659261200827-1e6a90e8e0a3?auto=format&fit=crop&w=1000&q=85',
zucchini:'https://images.unsplash.com/photo-1563252722-6434563a985d?auto=format&fit=crop&w=1000&q=85',
carrot:'https://images.unsplash.com/photo-1445282768818-728615cc910a?auto=format&fit=crop&w=1000&q=85',
lettuce:'https://images.unsplash.com/photo-1556801712-76c8eb07bbc9?auto=format&fit=crop&w=1000&q=85',
cabbage:'https://images.unsplash.com/photo-1594282486552-05b4d80fbb9f?auto=format&fit=crop&w=1000&q=85',
spinach:'https://images.unsplash.com/photo-1576045057995-568f588f82fb?auto=format&fit=crop&w=1000&q=85',
beans:'https://images.unsplash.com/photo-1515543904379-3d757ange7b?auto=format&fit=crop&w=1000&q=85',
rice:'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=1000&q=85',
flour:'https://images.unsplash.com/photo-1627485937980-221c88ac04f9?auto=format&fit=crop&w=1000&q=85',
grain:'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1000&q=85',
lentils:'https://images.unsplash.com/photo-1515543904379-3d757ange7b?auto=format&fit=crop&w=1000&q=85',
chickpeas:'https://images.unsplash.com/photo-1515543904379-3d757ange7b?auto=format&fit=crop&w=1000&q=85',
peas:'https://images.unsplash.com/photo-1587735243615-c03f25aaff15?auto=format&fit=crop&w=1000&q=85',
milk:'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=1000&q=85',
yogurt:'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=1000&q=85',
cheese:'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?auto=format&fit=crop&w=1000&q=85',
butter:'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?auto=format&fit=crop&w=1000&q=85',
cream:'https://images.unsplash.com/photo-1628088062854-d1870b4553da?auto=format&fit=crop&w=1000&q=85',
chicken:'https://images.unsplash.com/photo-1604503468506-a8da13d82791?auto=format&fit=crop&w=1000&q=85',
eggs:'https://images.unsplash.com/photo-1506976785307-8732e854ad03?auto=format&fit=crop&w=1000&q=85',
fish:'https://images.unsplash.com/photo-1510130387422-82bed34b37e9?auto=format&fit=crop&w=1000&q=85',
shrimp:'https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?auto=format&fit=crop&w=1000&q=85',
honey:'https://images.unsplash.com/photo-1587049352851-8d4e89133924?auto=format&fit=crop&w=1000&q=85',
syrup:'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=1000&q=85',
walnut:'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?auto=format&fit=crop&w=1000&q=85',
nuts:'https://images.unsplash.com/photo-1536591375667-f7f7b6c5e1a5?auto=format&fit=crop&w=1000&q=85',
pistachio:'https://images.unsplash.com/photo-1563412885-139e4045eb7c?auto=format&fit=crop&w=1000&q=85',
dried:'https://images.unsplash.com/photo-1596591606975-97ee5cef3a1e?auto=format&fit=crop&w=1000&q=85',
raisins:'https://images.unsplash.com/photo-1596363505729-4190a9506133?auto=format&fit=crop&w=1000&q=85',
seeds:'https://images.unsplash.com/photo-1509358271058-acd22cc93898?auto=format&fit=crop&w=1000&q=85',
herbs:'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=1000&q=85',
drink:'https://images.unsplash.com/photo-1543255006-d6395b6f1171?auto=format&fit=crop&w=1000&q=85',
pickles:'https://images.unsplash.com/photo-1589135233689-3b4a5c3e4f8f?auto=format&fit=crop&w=1000&q=85',
jam:'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=1000&q=85'
};
