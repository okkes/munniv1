import { useQuery } from '@/db/useQuery';
import { useData } from '@/app/data';
import type { Lang } from '@/i18n';

/**
 * Release notes shown in-app (user request: "news notification that
 * explains the latest changes"). MAINTENANCE RULE: every release arc
 * appends one entry here, newest FIRST, all three languages — this list
 * is the user-facing changelog, curated (what changed for THEM), not
 * the git log.
 */
export interface WhatsNewEntry {
  /** app version the entry belongs to (matches release-please tags) */
  version: string;
  date: string; // yyyy-mm-dd
  items: Record<Lang, string>[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '2.27.0',
    date: '2026-08-02',
    items: [
      {
        en: 'Loans became one thing: the account IS the debt. Interest, size, note and payment rhythm live right on the loan account, existing debts fold in by themselves, and paying one off is a milestone (archive), not a delete. Link a payment and the balance moves with it — draws deepen it, unlinking gives it back — while older payments stay out of a freshly typed balance unless you deliberately count them in. After creating a loan, munni searches your whole history for its payments by account number, amount, label and name; and the amount fields do little arithmetic, so 3*250+100 just works.',
        nl: 'Leningen werden één ding: de rekening IS de schuld. Rente, omvang, notitie en aflosritme staan op de leenrekening zelf, bestaande schulden vouwen zichzelf erin, en aflossen is een mijlpaal (archiveren), geen verwijderen. Koppel een aflossing en het saldo beweegt mee — opnames verdiepen het, ontkoppelen geeft het terug — terwijl oudere betalingen buiten een net getypt saldo blijven tenzij je ze bewust meetelt. Na het aanmaken doorzoekt munni je hele geschiedenis op aflossingen via rekeningnummer, bedrag, label en naam; en de bedragvelden rekenen mee, dus 3*250+100 werkt gewoon.',
        tr: 'Krediler tek şey oldu: hesap borcun TA KENDİSİ. Faiz, tutar, not ve ödeme ritmi kredi hesabının üzerinde durur, mevcut borçlar kendiliğinden içine katlanır ve bitirmek bir kilometre taşıdır (arşiv), silme değil. Bir ödemeyi bağla, bakiye onunla oynar — çekimler derinleştirir, bağı kaldırmak geri verir — yeni yazılmış bir bakiyenin öncesindeki ödemelerse sen bilerek saydırmadıkça dışarıda kalır. Kredi oluşturunca munni tüm geçmişini hesap numarası, tutar, etiket ve ada göre ödemeler için tarar; tutar alanları da hesap yapar, 3*250+100 çalışır.',
      },
      {
        en: 'Yearly subscriptions finally get spotted: recurring-cost detection reads your FULL bank history — even charges older than the space’s start date count as pattern evidence while your lists stay clean — and new bank connections ask for up to two years of history where the bank allows it.',
        nl: 'Jaarabonnementen worden eindelijk herkend: detectie van vaste lasten leest je VOLLEDIGE bankgeschiedenis — ook afschrijvingen ouder dan de startdatum van de ruimte tellen als bewijs terwijl je lijsten schoon blijven — en nieuwe bankkoppelingen vragen tot twee jaar geschiedenis waar de bank het toestaat.',
        tr: 'Yıllık abonelikler sonunda yakalanıyor: düzenli gider tespiti TÜM banka geçmişini okur — alanın başlangıç tarihinden eski çekimler bile desen kanıtı sayılır, listelerin temiz kalır — ve yeni banka bağlantıları, banka izin verdiği ölçüde iki yıla kadar geçmiş ister.',
      },
      {
        en: 'The big number on Home is your choice now, per space: net worth, total cash, safe to spend, or hand-picked accounts — unfold the band to switch and to give each account a say in the sum.',
        nl: 'Het grote getal op Home is nu jouw keuze, per ruimte: vermogen, totaal contant, vrij te besteden of gekozen rekeningen — klap de balk uit om te wisselen en elke rekening zeggenschap in de som te geven.',
        tr: 'Ana ekrandaki büyük sayı artık senin seçimin, alan başına: net varlık, toplam nakit, harcanabilir veya seçilen hesaplar — bandı aç, değiştir ve her hesaba toplamda söz hakkı ver.',
      },
      {
        en: 'Sheets protect your work: an accidental swipe or tap outside a form with unsaved edits asks "Discard changes?" first, lists inside sheets scroll when they can and drag the sheet when they can’t, and the color wheel is properly draggable in every direction.',
        nl: 'Panelen beschermen je werk: een onbedoelde veeg of tik buiten een formulier met niet-opgeslagen wijzigingen vraagt eerst "Wijzigingen weggooien?", lijsten in panelen scrollen als het kan en slepen het paneel als het niet kan, en het kleurenwiel is in elke richting netjes sleepbaar.',
        tr: 'Paneller emeğini korur: kaydedilmemiş düzenlemeleri olan bir formun dışına yanlışlıkla kaydırma ya da dokunma önce "Değişiklikler silinsin mi?" diye sorar, panellerdeki listeler kayabiliyorken kayar, kayamıyorken paneli sürükler ve renk tekerleği her yönde düzgünce sürüklenir.',
      },
      {
        en: 'Accounts got clearer everywhere: the space’s account rows open an info sheet with the full story (source, IBAN, start date, last sync), the transfer counterparty picker has ONE Create door that includes bank connect and in-place imports, imports show progress and readable previews, the start date is truly honored by imports, and money for a shared bank account is simply a transfer marked "To/From shared account".',
        nl: 'Rekeningen werden overal duidelijker: de rijen van een ruimte openen een infopaneel met het hele verhaal (bron, IBAN, startdatum, laatste synchronisatie), de tegenpartij-kiezer heeft ÉÉN Aanmaken-deur inclusief bankkoppeling en importeren ter plekke, imports tonen voortgang en leesbare voorbeelden, de startdatum wordt door imports echt gerespecteerd, en geld voor een gedeelde rekening is gewoon een overboeking "Naar/Van gedeelde rekening".',
        tr: 'Hesaplar her yerde netleşti: alanın hesap satırları tüm hikâyeyi anlatan bir bilgi paneli açar (kaynak, IBAN, başlangıç tarihi, son eşitleme), transfer karşı taraf seçicisinde banka bağlama ve yerinde içe aktarmayı da içeren TEK Oluştur kapısı var, içe aktarmalar ilerleme ve okunur önizleme gösterir, başlangıç tarihine içe aktarmalar gerçekten uyar ve ortak hesaba giden para "Ortak hesaba/hesaptan" işaretli sıradan bir transferdir.',
      },
      {
        en: 'Mina’s tour is sturdier: lesson sheets can’t be swiped away mid-lesson (nested pickers still close), the create buttons wear a gentle glow while you stay free to edit, the delete lesson works to the end, and her pages are one calm centered column on desktop too. Recurring costs can wear your own uploaded image, and the login language picker is a proper bottom sheet.',
        nl: 'Mina’s rondleiding is steviger: lespanelen kun je niet midden in een les wegvegen (geneste kiezers sluiten gewoon), de aanmaakknoppen dragen een zachte gloed terwijl jij vrij blijft bewerken, de verwijderles werkt tot het einde, en haar pagina’s zijn ook op desktop één rustige gecentreerde kolom. Vaste lasten kunnen je eigen geüploade afbeelding dragen, en de taalkiezer bij het inloggen is een echt onderpaneel.',
        tr: 'Mina’nın turu daha sağlam: ders panelleri dersin ortasında kaydırılıp atılamaz (iç içe seçiciler yine kapanır), oluştur düğmeleri sen düzenlemekte özgürken yumuşak bir ışıltı taşır, silme dersi sonuna dek çalışır ve sayfaları masaüstünde de tek sakin ortalanmış sütun. Düzenli giderler kendi yüklediğin görseli taşıyabilir ve girişteki dil seçici gerçek bir alt panel.',
      },
    ],
  },
  {
    version: '2.26.0',
    date: '2026-07-28',
    items: [
      {
        en: 'Debts, rebuilt around the truth: every debt is backed by a loan account (create one on the spot, named after the debt), transfers to that account ARE the payments, and the payoff projection follows real money instead of hand-typed numbers. A recurring cost that pays something off can hand itself over to debt creation — Mina explains the difference — and munni nudges weekly until the interest rate is filled in, where 0% counts as an answer.',
        nl: 'Schulden, herbouwd rond de waarheid: elke schuld heeft een leenrekening (maak er ter plekke één, vernoemd naar de schuld), overboekingen naar die rekening ZIJN de aflossingen, en de aflosprognose volgt echt geld in plaats van getypte getallen. Een vaste last die iets aflost kan zichzelf overdragen aan schuld-aanmaak — Mina legt het verschil uit — en munni herinnert je wekelijks tot de rente is ingevuld, waarbij 0% als antwoord telt.',
        tr: 'Borçlar gerçeğin etrafında yeniden kuruldu: her borcun bir kredi hesabı var (anında oluştur, borcun adıyla), o hesaba yapılan transferler ödemelerin TA KENDİSİ ve bitiş projeksiyonu elle yazılmış sayılar yerine gerçek parayı izliyor. Bir şeyi ödeyen düzenli gider kendini borç oluşturmaya devredebilir — Mina farkı açıklar — ve munni faiz oranı doldurulana dek her hafta hatırlatır; %0 da bir cevaptır.',
      },
      {
        en: 'Recurring costs own a category now: pick it once and every linked transaction files under it automatically — change it later and they all follow. A linked transaction only offers that category or Expected reimbursement, so a shared subscription still settles honestly.',
        nl: 'Vaste lasten hebben nu een eigen categorie: kies hem één keer en elke gekoppelde transactie wordt er automatisch onder gearchiveerd — wijzig hem later en alles volgt. Een gekoppelde transactie biedt alleen die categorie of Verwachte terugbetaling, zodat een gedeeld abonnement eerlijk blijft.',
        tr: 'Düzenli giderlerin artık kendi kategorisi var: bir kez seç, bağlı her işlem otomatik oraya dosyalanır — sonra değiştir, hepsi izler. Bağlı bir işlem yalnızca o kategoriyi veya Beklenen geri ödemeyi sunar; paylaşılan bir abonelik yine dürüstçe kapanır.',
      },
      {
        en: 'The accounts overview finally says where everything lives: bank connections and imports first (global), then each space with its own manual accounts. A transfer can create its counterparty on the spot — quick manual, or the full setup with bank connect and import — and in a shared space, connecting a bank asks a conscious yes before members can see it.',
        nl: 'Het rekeningenoverzicht zegt eindelijk waar alles leeft: bankkoppelingen en imports eerst (globaal), daarna elke ruimte met haar eigen handmatige rekeningen. Een overboeking kan haar tegenpartij ter plekke aanmaken — snel handmatig, of de volledige setup met bankkoppeling en import — en in een gedeelde ruimte vraagt een bankkoppeling eerst een bewuste ja voordat leden meekijken.',
        tr: 'Hesap genel görünümü sonunda her şeyin nerede yaşadığını söylüyor: önce banka bağlantıları ve içe aktarımlar (genel), sonra her alan kendi manuel hesaplarıyla. Bir transfer karşı tarafını anında oluşturabilir — hızlı manuel ya da banka bağlama ve içe aktarmayla tam kurulum — ve paylaşılan bir alanda banka bağlamak, üyeler görmeden önce bilinçli bir evet ister.',
      },
      {
        en: 'Mina’s tour flows like it should: the dimmed focus is a rounded spotlight that snaps to the target, switching lessons complete on the switch itself, the clean-up step hops back before deleting (the active space can’t delete itself), skipping asks on a full screen, and a run killed mid-onboarding stays quiet until onboarding is done.',
        nl: 'Mina’s rondleiding loopt zoals het hoort: de gedimde focus is een afgeronde spotlight die naar het doel springt, wissellessen ronden af op de wissel zelf, de opruimstap wipt eerst terug voor het verwijderen (de actieve ruimte kan zichzelf niet verwijderen), overslaan vraagt het op een volledig scherm, en een run die midden in de onboarding werd afgebroken blijft stil tot de onboarding klaar is.',
        tr: 'Mina’nın turu olması gerektiği gibi akıyor: karartılmış odak hedefe anında oturan yuvarlatılmış bir spot, geçiş dersleri geçişin kendisiyle tamamlanıyor, temizlik adımı silmeden önce geri dönüyor (aktif alan kendini silemez), atlama tam ekranda soruyor ve onboarding ortasında kapatılan bir tur onboarding bitene dek sessiz kalıyor.',
      },
      {
        en: 'Signing in on iPhone got honest: if the connection screen can’t get through for 20 seconds it shows the real reason and a Diagnose button whose report you can copy straight to support — it already found its first real bug.',
        nl: 'Inloggen op de iPhone werd eerlijk: komt het verbindingsscherm er 20 seconden niet doorheen, dan toont het de echte reden en een Diagnose-knop waarvan je het rapport zo naar support kopieert — hij vond zijn eerste echte bug al.',
        tr: 'iPhone’da oturum açmak dürüstleşti: bağlantı ekranı 20 saniye boyunca geçemezse gerçek nedeni ve raporunu doğrudan desteğe kopyalayabileceğin bir Tanıla düğmesi gösterir — ilk gerçek hatasını çoktan buldu.',
      },
    ],
  },
  {
    version: '2.25.0',
    date: '2026-07-28',
    items: [
      {
        en: 'Sheets got a new engine: typing in any bottom sheet no longer cancels itself, dragging follows your finger faithfully on every platform, and on iOS sheets finally open to their full height. A closing sheet also stops swallowing taps on its way out.',
        nl: 'Panelen kregen een nieuwe motor: typen in een paneel breekt zichzelf niet meer af, slepen volgt je vinger trouw op elk platform, en op iOS openen panelen eindelijk op volle hoogte. Een sluitend paneel slikt onderweg ook geen tikken meer in.',
        tr: 'Paneller yeni bir motor kazandı: bir panelde yazmak artık kendini iptal etmiyor, sürükleme her platformda parmağını sadakatle izliyor ve iOS’ta paneller sonunda tam yüksekliğe açılıyor. Kapanan bir panel de çıkarken dokunuşları yutmuyor.',
      },
      {
        en: 'iOS, steadied: what you type is never overwritten by a background sync anymore (recurring form, bulk checkboxes), the keyboard makes one clean move instead of two, taps between fields register immediately, and reordering rows in customize glides — the dropped row now settles softly into its place.',
        nl: 'iOS gestabiliseerd: wat je typt wordt niet meer overschreven door een synchronisatie op de achtergrond (vaste-lastenformulier, bulkvinkjes), het toetsenbord maakt één vloeiende beweging in plaats van twee, tikken tussen velden registreren direct, en rijen herschikken in aanpassen glijdt — de losgelaten rij nestelt zich nu zacht op zijn plek.',
        tr: 'iOS sağlamlaştı: yazdıkların artık arka plandaki eşitlemeyle silinmiyor (düzenli gider formu, toplu onay kutuları), klavye iki yerine tek temiz hamle yapıyor, alanlar arası dokunuşlar anında kaydoluyor ve özelleştirmede satırları yeniden sıralamak akıyor — bırakılan satır yerine yumuşakça oturuyor.',
      },
      {
        en: 'Linking a reimbursement has its own screen now: search by name or amount with highlighting, and a "Suggested" section spots the likely match from timing, wording (Tikkie, betaalverzoek…), bookkeeping and size. The prefilled amount follows what the transactions themselves earmark as reimbursement.',
        nl: 'Een terugbetaling koppelen heeft nu een eigen scherm: zoek op naam of bedrag met markering, en een sectie "Voorgesteld" herkent de waarschijnlijke match aan timing, omschrijving (Tikkie, betaalverzoek…), boekhouding en omvang. Het vooringevulde bedrag volgt wat de transacties zelf als terugbetaling oormerken.',
        tr: 'Geri ödeme bağlamanın artık kendi ekranı var: ada veya tutara göre vurgulamalı arama yap; "Önerilen" bölümü zamanlama, açıklama (Tikkie, betaalverzoek…), kayıt ve tutara bakarak olası eşleşmeyi bulur. Önceden doldurulan tutar, işlemlerin geri ödeme olarak ayırdığını izler.',
      },
      {
        en: 'Review is stricter where it matters: bulk apply only offers transactions the decision actually fits (a received reimbursement can never land on money you paid), types always follow the sign of each transaction — and old mistyped rows heal themselves. The counterparty row now appears only when Transfer is picked.',
        nl: 'Beoordelen is strenger waar het telt: bulk toepassen biedt alleen transacties waar de beslissing echt bij past (een ontvangen terugbetaling kan nooit op betaald geld landen), typen volgen altijd het teken van elke transactie — en oude verkeerd getypeerde regels herstellen zichzelf. De tegenpartijregel verschijnt nu alleen wanneer Overboeking is gekozen.',
        tr: 'İnceleme önemli yerde daha katı: toplu uygulama yalnızca kararın gerçekten uyduğu işlemleri sunar (alınan geri ödeme ödediğin paraya asla inemez), türler her işlemin işaretini izler — ve eski yanlış türlenmiş satırlar kendini onarır. Karşı taraf satırı artık yalnızca Transfer seçilince görünür.',
      },
      {
        en: 'The Mina tour flows better (she scrolls hidden buttons into view, explains why a second space exists, and space-switching completes on the switch itself), the guided cards stay on screen, her pictures respect the notch — and munni now guards its own data: a malformed write is refused and reported before it can ever land.',
        nl: 'De Mina-rondleiding loopt soepeler (ze scrolt verborgen knoppen in beeld, legt uit waarom een tweede ruimte bestaat, en ruimtewissels ronden af op de wissel zelf), de begeleidende kaarten blijven op het scherm, haar afbeeldingen respecteren de notch — en munni bewaakt nu zijn eigen gegevens: een misvormde schrijfactie wordt geweigerd en gemeld voor die ooit kan landen.',
        tr: 'Mina turu daha akıcı (gizli düğmeleri görünüme kaydırıyor, ikinci alanın nedenini açıklıyor ve alan geçişi geçişin kendisiyle tamamlanıyor), rehber kartlar ekranda kalıyor, görselleri çentiğe saygılı — ve munni artık kendi verisini koruyor: bozuk bir yazma işlemi daha inmeden reddedilip raporlanıyor.',
      },
    ],
  },
  {
    version: '2.24.0',
    date: '2026-07-25',
    items: [
      {
        en: 'Reimbursements, rebuilt: mark what you expect back on a transaction and munni tracks it until the money actually lands — the new "Reimbursed" category is applied for you (it left the pickers), settled and open amounts show side by side, budgets and the overview count the real gross with the paid-back part sliced out honestly, and a new filter surfaces everything still waiting to be paid back.',
        nl: 'Terugbetalingen, herbouwd: markeer wat je terugverwacht op een transactie en munni volgt het tot het geld echt binnen is — de nieuwe categorie "Terugbetaald" wordt voor je toegepast (ze verdween uit de kiezers), afgehandelde en openstaande bedragen staan naast elkaar, budgetten en het overzicht tellen het echte bruto met het terugbetaalde deel eerlijk uitgesneden, en een nieuw filter toont alles wat nog wacht op terugbetaling.',
        tr: 'Geri ödemeler yeniden kuruldu: bir işlemde geri beklediğini işaretle, munni parayı gerçekten gelene kadar izler — yeni "Geri ödendi" kategorisi senin yerine uygulanır (seçicilerden çıktı), kapanan ve açık tutarlar yan yana görünür, bütçeler ve genel bakış geri ödenen kısmı dürüstçe ayırarak gerçek brütü sayar ve yeni bir filtre hâlâ geri ödeme bekleyen her şeyi öne çıkarır.',
      },
      {
        en: 'A guided welcome: new identities get a walkthrough that sets up the real thing — meet your space, create your first account and transaction with your own hands, see why a second space starts empty. It resumes where your data says you left off, and skipping asks exactly once whether you are sure.',
        nl: 'Een begeleide start: nieuwe gebruikers krijgen een rondleiding die het echte werk opzet — maak kennis met je ruimte, maak je eerste rekening en transactie met eigen handen, en zie waarom een tweede ruimte leeg begint. Ze gaat verder waar je gegevens zeggen dat je gebleven was, en overslaan vraagt precies één keer of je het zeker weet.',
        tr: 'Rehberli bir karşılama: yeni kimlikler gerçeğini kuran bir tur alır — alanınla tanış, ilk hesabını ve işlemini kendi ellerinle oluştur, ikinci bir alanın neden boş başladığını gör. Verilerin nerede kaldığını söylüyorsa oradan devam eder ve atlamak tam bir kez emin olup olmadığını sorar.',
      },
      {
        en: 'When a bank connection meets your statement uploads, the connection is the truth: munni offers a reconcile pass that matches uploaded rows to the bank\'s own, migrates your edits (with a per-match opt-out), and shows every mismatch before anything is deleted — history outside the connection\'s window always survives. Statement uploads are also listed as batches now: who uploaded what, and one tap takes a bad upload back out.',
        nl: 'Wanneer een bankkoppeling je afschrift-uploads tegenkomt, is de koppeling de waarheid: munni biedt een afstemronde die geüploade regels aan die van de bank koppelt, je bewerkingen meeneemt (met per match een uitzetknop) en elke afwijking toont vóór er iets wordt verwijderd — geschiedenis buiten het venster van de koppeling blijft altijd staan. Afschrift-uploads staan nu ook als batches in de lijst: wie wat uploadde, en één tik haalt een verkeerde upload er weer uit.',
        tr: 'Bir banka bağlantısı ekstre yüklemelerinle karşılaştığında doğru olan bağlantıdır: munni yüklenen satırları bankanınkilerle eşleştiren, düzenlemelerini taşıyan (eşleşme başına vazgeçme seçeneğiyle) ve hiçbir şey silinmeden önce her uyumsuzluğu gösteren bir mutabakat turu önerir — bağlantının penceresi dışındaki geçmiş her zaman korunur. Ekstre yüklemeleri artık partiler hâlinde de listelenir: kim neyi yükledi ve tek dokunuş kötü bir yüklemeyi geri alır.',
      },
      {
        en: 'You can see your signed-in devices now: name them, and sign one out remotely — it wipes itself the next time it talks to the server. The app and server also check they still understand each other after updates, so instead of a vague "offline" you get the honest reason: update the app, or the servers are being updated.',
        nl: 'Je ziet nu je ingelogde apparaten: geef ze een naam en meld er één op afstand af — het wist zichzelf zodra het weer met de server praat. De app en server controleren na updates ook of ze elkaar nog verstaan, dus in plaats van een vaag "offline" krijg je de eerlijke reden: werk de app bij, of de servers worden bijgewerkt.',
        tr: 'Artık oturum açmış cihazlarını görebilirsin: onlara ad ver ve birini uzaktan çıkış yaptır — sunucuyla bir sonraki konuşmasında kendini siler. Uygulama ve sunucu, güncellemelerden sonra birbirlerini hâlâ anladıklarını da denetler; belirsiz bir "çevrimdışı" yerine dürüst nedeni görürsün: uygulamayı güncelle ya da sunucular güncelleniyor.',
      },
      {
        en: 'Imports and sheets, steadied: the rare "200 transactions imported, then everything disappeared" is fixed at the root (a double-tapped Import raced itself — the button now waits, and the server forgives), PayPal CSV exports import too, the notes field scrolls into view when the keyboard opens and the tab bar steps aside, a sheet you are dragging can no longer be stolen by the content under your finger, and the Home and transaction-detail customize sheets got icons and the same drag handle as categories.',
        nl: 'Imports en panelen, gestabiliseerd: het zeldzame "200 transacties geïmporteerd en toen verdween alles" is bij de wortel opgelost (een dubbel getikte Importeren racete tegen zichzelf — de knop wacht nu, en de server vergeeft), PayPal-CSV-exports importeren ook, het notitieveld scrolt in beeld wanneer het toetsenbord opent en de tabbalk stapt opzij, een paneel dat je sleept kan niet langer worden gekaapt door de inhoud onder je vinger, en de aanpas-panelen van Home en transactiedetails kregen iconen en dezelfde sleepgreep als categorieën.',
        tr: 'İçe aktarma ve paneller sağlamlaştı: nadir görülen "200 işlem içe aktarıldı, sonra her şey kayboldu" kökünden düzeltildi (çift dokunulan İçe aktar kendisiyle yarışıyordu — düğme artık bekliyor, sunucu affediyor), PayPal CSV dışa aktarımları da içe aktarılıyor, klavye açılınca not alanı görünüme kayıyor ve sekme çubuğu kenara çekiliyor, sürüklediğin bir panel artık parmağının altındaki içerik tarafından çalınamıyor ve Ana sayfa ile işlem detayının özelleştirme panelleri simgeler ve kategorilerdekiyle aynı sürükleme tutamacını kazandı.',
      },
    ],
  },
  {
    version: '2.23.0',
    date: '2026-07-24',
    items: [
      {
        en: 'Quicker links, honest amounts: creating a recurring cost or event from review — and now also from a transaction’s detail — prefills the form from the transaction and reliably attaches the new item to it in one go. A recurring cost’s amount is now truly yours: munni never changes it behind your back, it only spots price changes and offers a one-tap “Update to …”. Statement imports accept several files at once, and go-offline plus account deletion moved to the bottom of your profile.',
        nl: 'Snellere koppelingen, eerlijke bedragen: een vaste last of gebeurtenis aanmaken vanuit beoordelen — en nu ook vanuit de transactiedetails — vult het formulier vooraf in vanuit de transactie en koppelt het nieuwe item betrouwbaar in één keer. Het bedrag van een vaste last is nu echt van jou: munni wijzigt het nooit stiekem, het signaleert alleen prijswijzigingen en biedt één tik “Bijwerken naar …”. Afschrift-imports accepteren meerdere bestanden tegelijk, en offline gaan plus accountverwijdering verhuisden naar de onderkant van je profiel.',
        tr: 'Daha hızlı bağlantılar, dürüst tutarlar: incelemeden — ve artık işlem detayından da — düzenli gider veya etkinlik oluşturmak formu işlemden doldurur ve yeni öğeyi tek seferde güvenilir şekilde bağlar. Düzenli giderin tutarı artık gerçekten senin: munni onu asla gizlice değiştirmez, yalnızca fiyat değişimlerini yakalar ve tek dokunuş “… olarak güncelle” önerir. Ekstre içe aktarımı aynı anda birden çok dosya kabul eder; çevrimdışına geçme ve hesap silme profilinin altına taşındı.',
      },
    ],
  },
  {
    version: '2.22.0',
    date: '2026-07-22',
    items: [
      {
        en: 'Read everything in your currency: pick a display currency on your profile and every list, balance and total renders in it, marked ≈ — your data keeps its original currency, transactions convert at their own day’s official ECB rate, and the balance band finally sums mixed-currency accounts honestly. Offline profiles set their own rates. The space’s own currency is now called the ledger currency: the stable unit budgets and totals are anchored in.',
        nl: 'Lees alles in jouw valuta: kies een weergavevaluta op je profiel en elke lijst, elk saldo en elk totaal wordt erin getoond, gemarkeerd met ≈ — je gegevens behouden hun oorspronkelijke valuta, transacties rekenen om tegen de officiële ECB-koers van hun eigen dag, en de saldobalk telt rekeningen met verschillende valuta eindelijk eerlijk op. Offlineprofielen stellen hun eigen koersen in. De valuta van de ruimte heet nu de grootboekvaluta: de vaste eenheid waarin budgetten en totalen verankerd zijn.',
        tr: 'Her şeyi kendi para biriminde oku: profilinde bir görüntüleme para birimi seç; her liste, bakiye ve toplam ≈ işaretiyle onda gösterilir — verilerin orijinal para biriminde kalır, işlemler kendi gününün resmî ECB kuruyla çevrilir ve bakiye bandı farklı para birimli hesapları nihayet dürüstçe toplar. Çevrimdışı profiller kendi kurlarını belirler. Alanın para birimi artık defter para birimi: bütçelerin ve toplamların bağlandığı sabit birim.',
      },
      {
        en: 'Take your account offline: a new "Go offline" option under Global settings converts your online account into a device-only offline profile — every space, transaction and budget stays exactly where it is, bank-linked accounts become manual accounts you keep by hand, and per shared space you choose whether to keep a snapshot. Your server data can be erased in the same step. One honest consent screen shows all of it before anything happens.',
        nl: 'Neem je account offline: een nieuwe optie "Offline gaan" onder Algemene instellingen zet je online-account om in een offlineprofiel dat alleen op dit apparaat leeft — elke ruimte, transactie en elk budget blijft precies waar het is, bankgekoppelde rekeningen worden handmatige rekeningen die je zelf bijhoudt, en per gedeelde ruimte kies je of je een momentopname bewaart. Je servergegevens kunnen in dezelfde stap gewist worden. Eén eerlijk toestemmingsscherm toont alles voordat er iets gebeurt.',
        tr: 'Hesabını çevrimdışına taşı: Genel ayarlar altındaki yeni "Çevrimdışına geç" seçeneği çevrimiçi hesabını yalnızca bu cihazda yaşayan bir çevrimdışı profile dönüştürür — her alan, işlem ve bütçe olduğu yerde kalır, bankaya bağlı hesaplar elle tuttuğun manuel hesaplara dönüşür ve paylaşılan her alan için anlık görüntü tutup tutmayacağını seçersin. Sunucu verilerin aynı adımda silinebilir. Tek bir dürüst onay ekranı, bir şey olmadan önce hepsini gösterir.',
      },
      {
        en: 'The currency lens, everywhere: budgets, goals, the overview, trends, debts, events, envelopes, recurring costs and every Home block now render in your display currency (marked ≈) — budget and goal progress still computes in the ledger currency, so a bar never moves because an exchange rate did. Switch or clear the lens right from the balance band’s fold-out. And a freshly connected bank account that isn’t visible in any space yet now offers a one-tap attach to your active space.',
        nl: 'De valutalens, overal: budgetten, doelen, het overzicht, trends, schulden, gebeurtenissen, enveloppen, vaste lasten en elk Home-blok tonen nu je weergavevaluta (gemarkeerd met ≈) — budget- en doelvoortgang rekent nog steeds in de grootboekvaluta, dus een balk beweegt nooit omdat een wisselkoers bewoog. Wissel of wis de lens direct vanuit de uitklap van de saldobalk. En een net verbonden bankrekening die nog in geen enkele ruimte zichtbaar is, biedt nu één tik om aan je actieve ruimte te koppelen.',
        tr: 'Para birimi merceği her yerde: bütçeler, hedefler, genel bakış, eğilimler, borçlar, etkinlikler, zarflar, düzenli giderler ve her Ana sayfa bloğu artık görüntüleme para biriminde gösteriliyor (≈ ile işaretli) — bütçe ve hedef ilerlemesi hâlâ defter para biriminde hesaplanır, yani bir çubuk kur oynadı diye asla oynamaz. Merceği bakiye bandının açılır kısmından değiştir veya temizle. Ayrıca henüz hiçbir alanda görünmeyen yeni bağlanmış bir banka hesabı, aktif alanına tek dokunuşla eklenmeyi öneriyor.',
      },
      {
        en: 'Encrypted by default: new installs of the app store everything in an encrypted database from day one, and the setting now proves it — it names the encryption engine version reported by the database itself, and a one-tap check writes and reads a probe through the encrypted store.',
        nl: 'Standaard versleuteld: nieuwe installaties van de app bewaren alles vanaf dag één in een versleutelde database, en de instelling bewijst het nu ook — ze toont de versie van de versleutelingsengine zoals de database die zelf rapporteert, en één tik schrijft en leest een proefrij door de versleutelde opslag.',
        tr: 'Varsayılan olarak şifreli: uygulamanın yeni kurulumları her şeyi ilk günden şifreli bir veritabanında saklıyor ve ayar bunu artık kanıtlıyor — veritabanının kendisinin bildirdiği şifreleme motoru sürümünü gösteriyor ve tek dokunuş şifreli depo üzerinden bir deneme satırı yazıp okuyor.',
      },
      {
        en: 'Settings, untangled: the Settings tab now opens with your space — one card that leads to its name, image and color — while your profile lives under Global settings where it belongs. The budget period, currency and default history start became their own settings with their current value visible at a glance, and the new period screen explains the money rhythm it sets, with its own tutorial behind the ?.',
        nl: 'Instellingen, ontward: het tabblad Instellingen opent nu met je ruimte — één kaart die naar haar naam, afbeelding en kleur leidt — terwijl je profiel onder Algemene instellingen woont, waar het hoort. De budgetperiode, valuta en standaard historiestart werden eigen instellingen met hun huidige waarde in één oogopslag zichtbaar, en het nieuwe periodescherm legt het geldritme uit dat het bepaalt, met een eigen tutorial achter het vraagteken.',
        tr: 'Ayarlar çözüldü: Ayarlar sekmesi artık alanınla açılıyor — adına, görseline ve rengine götüren tek bir kart — profilin ise ait olduğu yerde, Genel ayarlar altında. Bütçe dönemi, para birimi ve varsayılan geçmiş başlangıcı, mevcut değeri bir bakışta görünen ayrı ayarlar oldu; yeni dönem ekranı belirlediği para ritmini açıklıyor ve soru işaretinin arkasında kendi eğitimi var.',
      },
      {
        en: 'ING, fully supported: import your ING CSV exports — current account, savings and credit card, transactions and balance history, Dutch or English — and munni recognizes accounts, dedupes overlapping files and keeps balances current. The import button now asks which format you have and tells you exactly how to export it. Adding a manual transaction uses the same category editor as review, offline profiles can be deleted (with everything they own), and stacked sheets got layered heights with smoother animations.',
        nl: 'ING, volledig ondersteund: importeer je ING-CSV-exports — betaalrekening, spaarrekening en creditcard, transacties én saldohistorie, Nederlands of Engels — en munni herkent rekeningen, ontdubbelt overlappende bestanden en houdt saldi actueel. De importknop vraagt nu welk formaat je hebt en vertelt precies hoe je het exporteert. Een handmatige transactie toevoegen gebruikt dezelfde categoriebewerker als beoordelen, offlineprofielen zijn te verwijderen (met alles wat erbij hoort), en gestapelde panelen kregen gelaagde hoogtes met soepelere animaties.',
        tr: 'ING tam desteklendi: ING CSV dışa aktarımlarını içe aktar — vadesiz, tasarruf ve kredi kartı; işlemler ve bakiye geçmişi; Hollandaca veya İngilizce — munni hesapları tanır, çakışan dosyaları ayıklar ve bakiyeleri güncel tutar. İçe aktarma düğmesi artık hangi formatın olduğunu soruyor ve tam olarak nasıl dışa aktaracağını söylüyor. Manuel işlem ekleme, incelemedekiyle aynı kategori düzenleyicisini kullanıyor; çevrimdışı profiller (sahip oldukları her şeyle) silinebiliyor ve üst üste sayfalar katmanlı yükseklikler ile daha akıcı animasyonlar kazandı.',
      },
      {
        en: 'Review, sharpened: the category editor opens on the actual current category (no more Uncategorized surprise), rows can be removed again, bulk-apply counts leave out skipped cards, and each category shows its main group alongside. Dragging is back for categories too — pull a custom subcategory onto another group to move it — and stacked bottom sheets now visibly layer instead of hiding behind a thin bar.',
        nl: 'Beoordelen, aangescherpt: de categoriebewerker opent op de echte huidige categorie (geen Ongecategoriseerd-verrassing meer), rijen zijn weer te verwijderen, bulk-toepassen telt overgeslagen kaarten niet mee, en elke categorie toont haar hoofdgroep ernaast. Slepen is terug voor categorieën — trek een eigen subcategorie naar een andere groep om haar te verplaatsen — en gestapelde panelen tonen nu zichtbaar hun lagen in plaats van achter een dun balkje te schuilen.',
        tr: 'İnceleme keskinleşti: kategori düzenleyici gerçek mevcut kategoriyle açılıyor (Kategorisiz sürprizi yok), satırlar yeniden silinebiliyor, toplu uygulama atlanan kartları saymıyor ve her kategori yanında ana grubunu gösteriyor. Kategorilerde sürükleme geri döndü — özel bir alt kategoriyi başka bir gruba çekerek taşı — ve üst üste açılan sayfalar ince bir çubuğun ardına saklanmak yerine katmanlarını görünür şekilde gösteriyor.',
      },
      {
        en: 'One way to add an account, everywhere: a single chooser now asks what you mean — connect a bank, import a statement, or add a manual account — and says where the result will live. It opens from the accounts screens and straight from the empty transactions list, and language and country pickers got real flags. Signed-in newcomers also get their country suggested automatically during setup.',
        nl: 'Eén manier om een rekening toe te voegen, overal: één keuzevenster vraagt nu wat je bedoelt — bank verbinden, afschrift importeren of handmatige rekening toevoegen — en vertelt waar het resultaat komt te leven. Het opent vanuit de rekeningschermen en direct vanuit de lege transactielijst, en taal- en landkiezers kregen echte vlaggen. Nieuwe ingelogde gebruikers krijgen hun land tijdens de installatie ook automatisch voorgesteld.',
        tr: 'Hesap eklemenin tek yolu, her yerde: tek bir seçici artık ne istediğini soruyor — banka bağla, ekstre aktar veya manuel hesap ekle — ve sonucun nerede yaşayacağını söylüyor. Hesap ekranlarından ve boş işlem listesinden doğrudan açılıyor; dil ve ülke seçiciler gerçek bayraklar kazandı. Yeni kayıt olan kullanıcılara kurulumda ülkeleri otomatik öneriliyor.',
      },
      {
        en: 'A fresh start, properly: one first-run setup for online and offline users — pick an avatar (or upload a photo), tell us how to call you and where you use munni (it sharpens category suggestions), keep or change your language, and set the app lock — with the tab bar out of the way. The bank step left onboarding; a guided tutorial takes that over.',
        nl: 'Een frisse start, maar dan goed: één eerste-keer-instelling voor online en offline gebruikers — kies een avatar (of upload een foto), vertel hoe we je mogen noemen en waar je munni gebruikt (dat scherpt categoriesuggesties aan), behoud of wijzig je taal en stel de app-vergrendeling in — met de tabbalk uit beeld. De bankstap verliet de onboarding; een begeleide tutorial neemt dat over.',
        tr: 'Taze bir başlangıç, hakkıyla: çevrimiçi ve çevrimdışı kullanıcılar için tek bir ilk kurulum — avatar seç (veya fotoğraf yükle), sana nasıl sesleneceğimizi ve munni’yi nerede kullandığını söyle (kategori önerilerini keskinleştirir), dilini koru veya değiştir ve uygulama kilidini kur — sekme çubuğu yolundan çekilmiş halde. Banka adımı karşılamadan çıktı; rehberli eğitim onu devralıyor.',
      },
      {
        en: 'Flags and clarity: language and country pickers now show real flag icons (bundled, so they work offline and on every platform), the space accounts screen gained a tutorial explaining the three account kinds, detaching an account now warns exactly what the space loses, and manual accounts pick their own currency.',
        nl: 'Vlaggen en duidelijkheid: taal- en landkiezers tonen nu echte vlagpictogrammen (meegeleverd, dus ze werken offline en op elk platform), het rekeningenscherm van de ruimte kreeg een tutorial over de drie rekeningsoorten, ontkoppelen waarschuwt nu precies wat de ruimte verliest, en handmatige rekeningen kiezen hun eigen valuta.',
        tr: 'Bayraklar ve netlik: dil ve ülke seçiciler artık gerçek bayrak simgeleri gösteriyor (pakete dahil — çevrimdışı ve her platformda çalışır), alanın hesaplar ekranı üç hesap türünü anlatan bir eğitim kazandı, hesap ayırma alanın tam olarak neyi kaybedeceğini söylüyor ve manuel hesaplar kendi para birimini seçiyor.',
      },
      {
        en: 'The bell now keeps a history: the last 200 actions in your space — who reviewed what, added a transaction, attached an account or created a budget — synced so every member sees the same trail.',
        nl: 'De bel houdt nu een geschiedenis bij: de laatste 200 acties in je ruimte — wie wat beoordeelde, een transactie toevoegde, een rekening koppelde of een budget maakte — gesynchroniseerd zodat elk lid hetzelfde spoor ziet.',
        tr: 'Zil artık bir geçmiş tutuyor: alanındaki son 200 eylem — kim neyi inceledi, işlem ekledi, hesap bağladı veya bütçe oluşturdu — senkronize, böylece her üye aynı izi görür.',
      },
      {
        en: 'Accounts now come in three clear kinds: linked (open banking), imported (statement uploads) and manual. Only manual accounts take hand-typed transactions — imported ones are corrected by their next upload instead. Each space creates its own manual accounts right on its Financial accounts screen, and every row says where it came from: created in this space, your account, or shared by a member.',
        nl: 'Rekeningen zijn er nu in drie duidelijke soorten: gekoppeld (open banking), geïmporteerd (afschrift-uploads) en handmatig. Alleen handmatige rekeningen nemen zelf ingetypte transacties aan — geïmporteerde worden gecorrigeerd door hun volgende upload. Elke ruimte maakt haar eigen handmatige rekeningen direct op het scherm Financiële rekeningen, en elke rij vertelt waar ze vandaan komt: gemaakt in deze ruimte, jouw rekening, of gedeeld door een lid.',
        tr: 'Hesaplar artık üç net türde: bağlı (açık bankacılık), aktarılmış (ekstre yüklemeleri) ve manuel. Yalnızca manuel hesaplar elle girilen işlem kabul eder — aktarılmışları bir sonraki yükleme düzeltir. Her alan kendi manuel hesaplarını doğrudan Finansal hesaplar ekranında oluşturur ve her satır nereden geldiğini söyler: bu alanda oluşturuldu, senin hesabın veya bir üye tarafından paylaşıldı.',
      },
      {
        en: 'Choosing offline mode now shows you the honest trade on its own screen first: what you keep (total privacy with zero telemetry, the full app working without internet, PIN or fingerprint lock) and what you give up (bank connections, sync and cloud backup, shared spaces) — before you create a profile.',
        nl: 'Wie voor offline modus kiest, ziet nu eerst eerlijk de afweging: wat je behoudt (volledige privacy zonder telemetrie, de volledige app zonder internet, pincode- of vingerafdrukvergrendeling) en wat je opgeeft (bankkoppelingen, synchronisatie en cloudback-up, gedeelde ruimtes) — vóór je een profiel aanmaakt.',
        tr: 'Çevrimdışı modu seçince artık önce dürüst bir değiş tokuş görürsün: neler seninle kalır (telemetrisiz tam gizlilik, internetsiz çalışan uygulamanın tamamı, PIN veya parmak izi kilidi) ve nelerden vazgeçersin (banka bağlantıları, senkronizasyon ve bulut yedeği, paylaşılan alanlar) — profil oluşturmadan önce.',
      },
    ],
  },
  {
    version: '2.21.0',
    date: '2026-07-20',
    items: [
      {
        en: 'Receipts, rebuilt around connections you control: store logins are now named connections — connect the same store twice, give each a name and icon, and choose per space who sees its receipts (housemates included, with owner or contributor rights). Receipts are pulled once, fetched automatically right after new bank transactions arrive, and matched to them — respecting the paying card when the receipt shows one. A space that gains a connection re-checks all its transactions for matches, receipts got their own place in the space settings with filters, and attaching one to a transaction is now a single flow with the best candidates up front.',
        nl: 'Bonnetjes, herbouwd rond koppelingen die jij beheert: winkellogins zijn nu benoemde koppelingen — koppel dezelfde winkel twee keer, geef elk een naam en icoon, en kies per ruimte wie de bonnetjes ziet (huisgenoten incluis, met eigenaar- of bijdragerrechten). Bonnetjes worden één keer opgehaald, automatisch direct na nieuwe banktransacties, en eraan gekoppeld — met respect voor de betaalkaart als het bonnetje er een toont. Een ruimte die een koppeling erbij krijgt, controleert al haar transacties opnieuw op matches, bonnetjes kregen een eigen plek in de ruimte-instellingen met filters, en een bonnetje aan een transactie hangen is nu één flow met de beste kandidaten vooraan.',
        tr: 'Fişler, senin yönettiğin bağlantılar etrafında yeniden kuruldu: mağaza girişleri artık adlandırılmış bağlantılar — aynı mağazayı iki kez bağla, her birine ad ve simge ver, fişlerini alan başına kimin göreceğini seç (sahip veya katkıcı yetkisiyle ev arkadaşları dahil). Fişler bir kez çekilir, yeni banka işlemleri gelir gelmez otomatik alınır ve onlarla eşleştirilir — fişte ödeme kartı görünüyorsa ona uyarak. Bağlantı kazanan bir alan tüm işlemlerini yeniden eşleşme için tarar, fişler alan ayarlarında filtreli kendi yerini aldı ve bir fişi işleme eklemek artık en iyi adaylar önde tek bir akış.',
      },
      {
        en: 'You can finally delete a connected bank account. It disconnects the bank, removes the account with its transactions and everything built on them from every space — and if someone else also linked the same account, only your connection goes, theirs stays untouched.',
        nl: 'Je kunt een gekoppelde bankrekening eindelijk verwijderen. Het verbreekt de bankkoppeling en haalt de rekening met transacties en alles wat erop gebouwd is uit elke ruimte — en als iemand anders dezelfde rekening ook gekoppeld heeft, verdwijnt alleen jouw koppeling; die van hen blijft staan.',
        tr: 'Bağlı bir banka hesabını sonunda silebilirsin. Banka bağlantısını keser, hesabı işlemleriyle ve üzerine kurulu her şeyle birlikte tüm alanlardan kaldırır — aynı hesabı başka biri de bağladıysa yalnızca senin bağlantın gider, onlarınki olduğu gibi kalır.',
      },
      {
        en: 'Sharper day-to-day flows: manual accounts finally keep a live balance as you add and edit transactions, budgets show a per-period bar chart with days-until-reset and category rows that filter the payments, the category editor blocks a save when a category no longer fits the chosen type, counterparty and type open their own pickers on the transaction detail, destructive deletes all share one careful confirm sheet with a short cooldown, Home and detail sections reorder by drag, and the demo comes with six months of history plus a review backlog to try bulk-apply on.',
        nl: 'Scherpere dagelijkse flows: handmatige rekeningen houden eindelijk een live saldo bij terwijl je transacties toevoegt en bewerkt, budgetten tonen een staafgrafiek per periode met dagen-tot-reset en categorierijen die de betalingen filteren, de categoriebewerker blokkeert opslaan wanneer een categorie niet meer bij het gekozen type past, tegenpartij en type openen hun eigen kiezers op de transactiedetails, alle verwijderacties delen één zorgvuldig bevestigingspaneel met korte aftelling, Home- en detailsecties herschik je door te slepen, en de demo komt met zes maanden geschiedenis plus een beoordelingsachterstand om bulk-toepassen op te proberen.',
        tr: 'Daha keskin günlük akışlar: manuel hesaplar işlem ekleyip düzenledikçe nihayet canlı bakiye tutuyor, bütçeler dönem başına çubuk grafik, sıfırlanmaya kalan gün ve ödemeleri filtreleyen kategori satırları gösteriyor, kategori düzenleyici seçilen türe uymayan bir kategoriyle kaydetmeyi engelliyor, karşı taraf ve tür işlem detayında kendi seçicilerini açıyor, tüm silme işlemleri kısa geri sayımlı tek bir özenli onay sayfasını paylaşıyor, Ana ekran ve detay bölümleri sürükleyerek sıralanıyor ve demo, toplu uygulamayı denemek için altı aylık geçmiş ve bekleyen incelemelerle geliyor.',
      },
      {
        en: 'Accounts and spaces, clearer: each space now attaches accounts on its own Financial accounts screen — pick an existing account, set a start date, done — and detaching asks properly first. Account rows show when your bank last answered, with a reconnect hint when a connection has gone quiet. Two private spaces can no longer share a name, and identically-named shared spaces show who created them. New: onboarding offers to set up the app lock right away, and the language menu on the login screen closes when you tap elsewhere.',
        nl: 'Rekeningen en ruimtes, duidelijker: elke ruimte koppelt rekeningen nu op haar eigen scherm Financiële rekeningen — kies een bestaande rekening, stel een startdatum in, klaar — en ontkoppelen vraagt eerst netjes om bevestiging. Rekeningrijen tonen wanneer je bank voor het laatst antwoordde, met een herverbind-hint wanneer een koppeling stil is gevallen. Twee privéruimtes kunnen niet langer dezelfde naam dragen, en gedeelde ruimtes met dezelfde naam tonen wie ze heeft gemaakt. Nieuw: de onboarding biedt meteen aan de app-vergrendeling in te stellen, en het taalmenu op het inlogscherm sluit wanneer je ernaast tikt.',
        tr: 'Hesaplar ve alanlar daha net: her alan artık hesaplarını kendi Finansal hesaplar ekranında ekliyor — mevcut bir hesabı seç, başlangıç tarihini belirle, bitti — ve ayırma önce düzgünce onay istiyor. Hesap satırları bankanın en son ne zaman yanıt verdiğini gösteriyor; bağlantı sessizleştiğinde yeniden bağlanma ipucu beliriyor. İki özel alan artık aynı adı taşıyamıyor ve aynı adlı paylaşılan alanlar kimin oluşturduğunu gösteriyor. Yeni: karşılama akışı uygulama kilidini hemen kurmayı öneriyor ve giriş ekranındaki dil menüsü dışına dokununca kapanıyor.',
      },
      {
        en: 'A round of polish from your reports: the appearance setting is one clear light / dark / auto switch, "Moved to / from" is now called Counterparty and sits with type and categories in one grouped editor during review, icon search keeps the built-in icons visible when online results arrive, a picked account icon shows immediately (and bank syncs no longer overwrite your renames), and the stuck-button glitch after long-pressing a store login link is gone.',
        nl: 'Een polijstronde uit jouw meldingen: de weergave-instelling is één duidelijke licht / donker / auto-schakelaar, "Naar / van rekening" heet nu Tegenpartij en staat samen met type en categorieën in één gegroepeerde bewerker tijdens beoordelen, de icoonzoeker houdt de ingebouwde iconen zichtbaar wanneer online resultaten binnenkomen, een gekozen rekeningicoon verschijnt meteen (en banksynchronisaties overschrijven je hernoemingen niet meer), en de vastgelopen-knop-glitch na lang drukken op een winkel-loginlink is verholpen.',
        tr: 'Bildirimlerinden bir cila turu: görünüm ayarı tek ve net bir açık / koyu / otomatik anahtarı oldu, "Gittiği / geldiği hesap" artık Karşı taraf ve incelemede tür ile kategorilerle birlikte tek gruplu düzenleyicide duruyor, simge arama çevrimiçi sonuçlar gelince yerleşik simgeleri görünür tutuyor, seçilen hesap simgesi anında görünüyor (ve banka senkronizasyonları yeniden adlandırmalarını artık ezmiyor), mağaza giriş bağlantısına uzun basınca oluşan takılı-düğme hatası da giderildi.',
      },
    ],
  },
  {
    version: '2.20.1',
    date: '2026-07-20',
    items: [
      {
        en: 'Sync unclogged: one rejected change (a new topic or a set-aside) could silently block everything queued behind it — a hundred fresh store receipts included — and the app looked "offline" while the server was fine. The server now accepts what it should have, big uploads go in chunks that each land for good, and one stuck space can never freeze the others. Queued receipts sync through on their own after this update.',
        nl: 'Synchronisatie ontstopt: één afgewezen wijziging (een nieuw thema of opzij-zetten) kon stilletjes alles erachter blokkeren — honderd verse winkelbonnetjes incluis — en de app leek "offline" terwijl de server prima draaide. De server accepteert nu wat hij had moeten accepteren, grote uploads gaan in deelstukken die elk definitief landen, en één vastgelopen ruimte kan de rest nooit meer bevriezen. Bonnetjes in de wachtrij synchroniseren na deze update vanzelf door.',
        tr: 'Senkronizasyon açıldı: reddedilen tek bir değişiklik (yeni bir konu veya kenara ayırma) arkasında sıraya girmiş her şeyi — yüz taze market fişi dahil — sessizce tıkayabiliyordu ve sunucu sapasağlamken uygulama "çevrimdışı" görünüyordu. Sunucu artık kabul etmesi gerekeni kabul ediyor, büyük yüklemeler her biri kalıcı olarak inen parçalar hâlinde gidiyor ve takılan tek bir alan diğerlerini asla donduramıyor. Kuyruktaki fişler bu güncellemeden sonra kendiliğinden senkronize olur.',
      },
    ],
  },
  {
    version: '2.20.0',
    date: '2026-07-19',
    items: [
      {
        en: 'Allocation grows up: every recurring cost now has its own set-aside envelope — one tap funds the suggested share, and a yearly bill on monthly periods suggests exactly 1/12 so the inevitable never surprises you. And you can group envelopes into your own topics: create "Fun", drop entertainment and coffee in, and watch one subtotal instead of five rows.',
        nl: 'Toewijzen wordt volwassen: elke terugkerende kostenpost heeft nu een eigen opzij-zet-envelop — één tik dekt het voorgestelde deel, en een jaarlijkse rekening op maandperiodes stelt precies 1/12 voor zodat het onvermijdelijke je nooit verrast. En je kunt enveloppen groeperen in eigen thema\'s: maak "Fun", stop entertainment en koffie erin, en volg één subtotaal in plaats van vijf rijen.',
        tr: 'Tahsis büyüyor: her düzenli giderin artık kendi kenara-ayırma zarfı var — tek dokunuş önerilen payı karşılar; aylık dönemlerde yıllık bir fatura tam 1/12 önerir, kaçınılmaz olan seni asla şaşırtmaz. Zarfları kendi konularında da gruplayabilirsin: "Keyif" oluştur, eğlenceyi ve kahveyi içine at, beş satır yerine tek ara toplamı izle.',
      },
      {
        en: 'The admin console got a facelift — one consistent control language, calmer cards, and prediction keywords finally speak human: category names with the id as a subtitle, and a proper picker instead of typing ids.',
        nl: 'De beheerconsole kreeg een opknapbeurt — één consistente bedieningstaal, rustigere kaarten, en voorspellingstrefwoorden spreken eindelijk mensentaal: categorienamen met het id als ondertitel, en een echte kiezer in plaats van id\'s typen.',
        tr: 'Yönetim konsolu yenilendi — tek tutarlı kontrol dili, daha sakin kartlar; tahmin anahtar kelimeleri sonunda insanca konuşuyor: kimlik alt başlık olmak üzere kategori adları ve kimlik yazmak yerine gerçek bir seçici.',
      },
    ],
  },
  {
    version: '2.19.1',
    date: '2026-07-19',
    items: [
      {
        en: 'You stay signed in across app updates now. Every update restarts the app, and a start-up race could throw away a perfectly healthy session — requests fired before the sign-in state finished loading were mistaken for an expired login. The app now waits for the session to restore before talking to the server, and only a genuinely rejected login can sign you out.',
        nl: 'Je blijft nu ingelogd na app-updates. Elke update herstart de app, en een opstartrace kon een prima gezonde sessie weggooien — verzoeken die vertrokken vóór de inlogstatus geladen was, werden aangezien voor een verlopen login. De app wacht nu tot de sessie hersteld is voor hij met de server praat, en alleen een écht afgewezen login kan je nog uitloggen.',
        tr: 'Artık uygulama güncellemelerinde oturumun açık kalıyor. Her güncelleme uygulamayı yeniden başlatır ve bir açılış yarışı gayet sağlıklı bir oturumu çöpe atabiliyordu — oturum durumu yüklenmeden çıkan istekler süresi dolmuş giriş sanılıyordu. Uygulama artık sunucuyla konuşmadan önce oturumun geri yüklenmesini bekliyor; seni ancak gerçekten reddedilen bir giriş oturumdan çıkarabilir.',
      },
    ],
  },
  {
    version: '2.19.0',
    date: '2026-07-19',
    items: [
      {
        en: 'Two small clarity fixes: the category editor in review now says "Done" instead of "Save" (it only stages your choice — Confirm on the card is what writes), and removing a member from a space asks for confirmation first, spelling out what they lose.',
        nl: 'Twee kleine duidelijkheidsverbeteringen: de categoriebewerker in beoordelen zegt nu "Klaar" in plaats van "Opslaan" (het zet je keuze alleen klaar — Bevestigen op de kaart schrijft pas), en een lid uit een ruimte verwijderen vraagt eerst om bevestiging, met uitleg over wat diegene verliest.',
        tr: 'İki küçük netlik düzeltmesi: incelemedeki kategori düzenleyici artık "Kaydet" yerine "Tamam" diyor (yalnızca seçimini hazırlar — asıl yazan, karttaki Onayla), ve bir üyeyi alandan çıkarmak önce neyi kaybedeceğini açıklayarak onay istiyor.',
      },
    ],
  },
  {
    version: '2.18.1',
    date: '2026-07-19',
    items: [
      {
        en: 'Family accounts, done right: when two people each connect the same shared bank account, both consents stay respected — one person\'s cleanup can never cut off the other\'s access, and the data still arrives once for everyone. Also: deleting your account in the test app no longer touches the login identity the real app uses.',
        nl: 'Gezinsrekeningen, goed geregeld: wanneer twee mensen allebei dezelfde gedeelde bankrekening koppelen, blijven beide toestemmingen gerespecteerd — de opruiming van de één kan nooit de toegang van de ander afsnijden, en de data komt nog steeds één keer binnen voor iedereen. Ook: je account verwijderen in de testapp raakt niet langer de inlogidentiteit die de echte app gebruikt.',
        tr: 'Aile hesapları hakkıyla: iki kişi aynı ortak banka hesabını ayrı ayrı bağladığında iki rıza da korunur — birinin temizliği diğerinin erişimini asla kesemez ve veri herkes için yine tek sefer gelir. Ayrıca: test uygulamasında hesabını silmek, gerçek uygulamanın kullandığı giriş kimliğine artık dokunmuyor.',
      },
    ],
  },
  {
    version: '2.18.0',
    date: '2026-07-19',
    items: [
      {
        en: 'Leaving a shared space now cleans up after itself: accounts someone else shared there disappear from your overview instead of lingering forever. When the account\'s owner leaves while others stay, it shows as archived for them — history stays readable, new data stops. And duplicate bank consents tidy themselves: your account automatically rides the newest consent while older duplicates are released.',
        nl: 'Een gedeelde ruimte verlaten ruimt nu netjes op: accounts die iemand anders daar deelde verdwijnen uit je overzicht in plaats van eeuwig te blijven hangen. Vertrekt de eigenaar van het account terwijl anderen blijven, dan zien zij het als gearchiveerd — geschiedenis blijft leesbaar, nieuwe data stopt. Dubbele banktoestemmingen ruimen zichzelf op: je account rijdt automatisch op de nieuwste toestemming en oudere duplicaten worden vrijgegeven.',
        tr: 'Paylaşılan bir alandan ayrılmak artık arkasını topluyor: başkasının orada paylaştığı hesaplar sonsuza dek takılı kalmak yerine genel bakışından kayboluyor. Hesabın sahibi ayrılıp diğerleri kalırsa, onlar için arşivlenmiş görünür — geçmiş okunabilir kalır, yeni veri durur. Yinelenen banka rızaları da kendini topluyor: hesabın otomatik olarak en yeni rızaya biner, eski kopyalar serbest bırakılır.',
      },
    ],
  },
  {
    version: '2.17.0',
    date: '2026-07-19',
    items: [
      {
        en: 'Notifications now actually reach your phone: friend requests, space invites and new-transaction alerts show up even when munni is closed, in your own language. Under the hood the web app\'s offline worker was silently broken — repaired, so installed web apps cache and push again.',
        nl: 'Meldingen bereiken je telefoon nu echt: vriendschapsverzoeken, ruimte-uitnodigingen en nieuwe-transactiemeldingen verschijnen ook als munni dicht is, in je eigen taal. Onder de motorkap was de offline-worker van de webapp stilletjes kapot — gerepareerd, dus geïnstalleerde webapps cachen en pushen weer.',
        tr: 'Bildirimler artık telefonuna gerçekten ulaşıyor: arkadaşlık istekleri, alan davetleri ve yeni işlem uyarıları munni kapalıyken bile kendi dilinde görünüyor. Kaputun altında web uygulamasının çevrimdışı çalışanı sessizce bozulmuştu — onarıldı; kurulu web uygulamaları yeniden önbelleğe alıp bildirim gösteriyor.',
      },
      {
        en: 'Review starts fresh every visit — skipped cards return to the top of the deck when you come back later. Drilling into a category from a past period now keeps that period instead of snapping back to today, and bottom sheets no longer get stranded halfway up the screen when the keyboard closes on iPhone.',
        nl: 'Beoordelen begint elk bezoek opnieuw — overgeslagen kaarten liggen weer bovenop als je later terugkomt. Doorklikken naar een categorie vanuit een eerdere periode houdt nu die periode vast in plaats van terug te springen naar vandaag, en panelen blijven niet langer halverwege het scherm hangen wanneer het toetsenbord sluit op iPhone.',
        tr: 'İnceleme her ziyarette baştan başlıyor — atlanan kartlar sonra döndüğünde yeniden destenin üstünde. Geçmiş bir dönemden kategoriye inmek artık o dönemi koruyor, bugüne geri fırlamıyor; iPhone\'da klavye kapandığında alt paneller de ekranın ortasında asılı kalmıyor.',
      },
    ],
  },
  {
    version: '2.16.0',
    date: '2026-07-18',
    items: [
      {
        en: 'Bank connections no longer get lost half-way: when your bank\'s daily data budget runs out mid-link, the connection is saved anyway and munni finishes the job automatically once the budget resets — approved consents can\'t float in limbo anymore. Signing in also got steadier: parallel token refreshes no longer race each other into a forced re-login.',
        nl: 'Bankkoppelingen raken niet langer halverwege zoek: raakt het dagelijkse databudget van je bank op tijdens het koppelen, dan wordt de verbinding toch bewaard en maakt munni het werk automatisch af zodra het budget herstelt — goedgekeurde toestemmingen kunnen niet meer in het luchtledige zweven. Inloggen werd ook stabieler: parallelle tokenverversingen jagen elkaar niet langer een gedwongen herlogin in.',
        tr: 'Banka bağlantıları artık yarı yolda kaybolmuyor: bankanın günlük veri bütçesi bağlantı sırasında biterse bağlantı yine de kaydediliyor ve bütçe yenilenince munni işi otomatik tamamlıyor — onaylanmış rızalar artık boşlukta süzülemez. Giriş de sağlamlaştı: paralel jeton yenilemeleri artık birbirini zorla yeniden girişe sürüklemiyor.',
      },
      {
        en: 'Goals got their own cover pictures — houses, cars, travel, savings and more saving-for themes instead of borrowed event scenes.',
        nl: 'Doelen kregen hun eigen omslagfoto\'s — huizen, auto\'s, reizen, sparen en meer spaarthema\'s in plaats van geleende evenementbeelden.',
        tr: 'Hedefler kendi kapak resimlerine kavuştu — ödünç etkinlik sahneleri yerine ev, araba, seyahat, birikim ve daha fazla biriktirme teması.',
      },
    ],
  },
  {
    version: '2.15.0',
    date: '2026-07-18',
    items: [
      {
        en: 'Goals can carry a picture now, just like events — pick a bundled cover or upload your own, shown on the list and the goal itself. The event form\'s date fields render reliably on every device, and the "update available" note on iPhone now opens TestFlight directly.',
        nl: 'Doelen kunnen nu een afbeelding dragen, net als evenementen — kies een meegeleverde omslag of upload je eigen, getoond in de lijst en op het doel zelf. De datumvelden van het evenementformulier renderen betrouwbaar op elk apparaat, en de "update beschikbaar"-melding op iPhone opent nu direct TestFlight.',
        tr: 'Hedefler artık etkinlikler gibi resim taşıyabiliyor — hazır bir kapak seç ya da kendininkini yükle; listede ve hedefin kendisinde görünür. Etkinlik formunun tarih alanları her cihazda güvenilir görüntüleniyor ve iPhone\'daki "güncelleme var" notu artık doğrudan TestFlight\'ı açıyor.',
      },
    ],
  },
  {
    version: '2.14.0',
    date: '2026-07-18',
    items: [
      {
        en: 'Review became a full workbench: every decision — counterparty, type, categories, recurring cost and now events — is an editable row on a calmer, compact card. Missing something? Create a category, recurring cost or event straight from its picker; the deck keeps your place, even when you wander off mid-review. And "also apply to similar" now carries the whole decision to the siblings, not just the category.',
        nl: 'Beoordelen werd een volwaardige werkbank: elke beslissing — tegenpartij, type, categorieën, terugkerende kosten en nu ook evenementen — is een bewerkbare rij op een rustigere, compacte kaart. Mis je iets? Maak een categorie, terugkerende kostenpost of evenement direct vanuit de kiezer; het dek onthoudt je plek, ook als je tussendoor wegloopt. En "ook toepassen op vergelijkbare" neemt nu de hele beslissing mee naar de broertjes, niet alleen de categorie.',
        tr: 'İnceleme tam bir çalışma tezgahı oldu: her karar — karşı taraf, tür, kategoriler, düzenli ödeme ve artık etkinlikler — daha sakin, kompakt bir kartta düzenlenebilir bir satır. Bir şey mi eksik? Kategoriyi, düzenli ödemeyi veya etkinliği doğrudan seçicisinden oluştur; desteden ayrılsan bile kaldığın yer korunur. "Benzerlere de uygula" artık yalnızca kategoriyi değil kararın tamamını kardeşlere taşıyor.',
      },
      {
        en: 'Native sign-in loses its last popup: login and logout return through verified https links on the new builds. Also: budget category picking got search and folded groups, progress bars animate again when you switch periods, the budget back-arrow stops at your first cycle, and every Home block has a "See all".',
        nl: 'Native inloggen verliest zijn laatste popup: in- en uitloggen keren terug via geverifieerde https-links op de nieuwe builds. Verder: budgetcategorieën kiezen kreeg zoeken en ingeklapte groepen, voortgangsbalken animeren weer bij periodewissels, de terugpijl van budgetten stopt bij je eerste cyclus, en elk Home-blok heeft een "Bekijk alles".',
        tr: 'Yerel giriş son penceresini de kaybetti: yeni sürümlerde giriş ve çıkış doğrulanmış https bağlantılarıyla dönüyor. Ayrıca: bütçe kategorisi seçimine arama ve katlanmış gruplar geldi, ilerleme çubukları dönem değişiminde yeniden animasyonlu, bütçenin geri oku ilk döngünde duruyor ve her Ana sayfa bloğunda "Tümünü gör" var.',
      },
      {
        en: 'Transaction detail: the counterparty row moved above the type row, matching how you read a transfer.',
        nl: 'Transactiedetail: de tegenpartijrij staat nu boven de typerij, zoals je een overboeking leest.',
        tr: 'İşlem detayı: karşı taraf satırı, bir transferi okuma sırana uyacak şekilde tür satırının üstüne taşındı.',
      },
    ],
  },
  {
    version: '2.13.1',
    date: '2026-07-18',
    items: [
      {
        en: 'Renaming a transaction no longer sends the sheet flying off-screen when the keyboard opens, and a refused bank connection now shows the provider\'s own words — so a "forbidden" tells you exactly what to fix in their portal.',
        nl: 'Een transactie hernoemen laat het paneel niet langer van het scherm vliegen wanneer het toetsenbord opent, en een geweigerde bankkoppeling toont nu de eigen woorden van de aanbieder — een "forbidden" vertelt je precies wat je in hun portaal moet aanpassen.',
        tr: 'Bir işlemi yeniden adlandırmak, klavye açıldığında paneli artık ekran dışına uçurmuyor; reddedilen bir banka bağlantısı da artık sağlayıcının kendi ifadesini gösteriyor — bir "forbidden" onların panelinde tam olarak neyi düzelteceğini söylüyor.',
      },
    ],
  },
  {
    version: '2.13.0',
    date: '2026-07-18',
    items: [
      {
        en: 'Real app links: bank-consent returns and split invites are now verified https links that open the app directly — no more "Open in munni?" popup on iPhone once the new build is installed. Invite links work as normal web links for everyone else.',
        nl: 'Echte app-links: terugkeer na banktoestemming en split-uitnodigingen zijn nu geverifieerde https-links die de app direct openen — geen "Openen in munni?"-popup meer op iPhone zodra de nieuwe build is geïnstalleerd. Uitnodigingslinks werken als gewone weblinks voor iedereen anders.',
        tr: 'Gerçek uygulama bağlantıları: banka onayı dönüşleri ve bölüşme davetleri artık uygulamayı doğrudan açan doğrulanmış https bağlantıları — yeni sürüm kurulduktan sonra iPhone\'da "munni\'de aç?" penceresi yok. Davet bağlantıları diğer herkes için normal web bağlantısı olarak çalışır.',
      },
      {
        en: 'Transaction detail refined: one Edit button for the whole categories block, the type row reads value-first like its neighbours, the Details rows carry icons, and the duplicate struck-through amount left the header.',
        nl: 'Transactiedetail verfijnd: één Bewerken-knop voor het hele categorieënblok, de typeregel toont eerst de waarde net als zijn buren, de Details-regels hebben iconen, en het dubbele doorgestreepte bedrag is uit de kop verdwenen.',
        tr: 'İşlem detayı inceltildi: tüm kategoriler bloğu için tek Düzenle düğmesi, tür satırı komşuları gibi önce değeri gösteriyor, Detay satırlarında simgeler var ve başlıktaki mükerrer üstü çizili tutar kaldırıldı.',
      },
      {
        en: 'Categories feel consistent: holding your own sub-category now opens an action menu (edit, move) just like main categories — the accidental drag is gone — and every hold answers with a small vibration so you know the menu is coming. The tour explains it.',
        nl: 'Categorieën voelen consistent: je eigen subcategorie vasthouden opent nu een actiemenu (bewerken, verplaatsen) net als hoofdcategorieën — het onbedoelde slepen is weg — en elk vasthouden antwoordt met een kleine tril zodat je weet dat het menu komt. De tour legt het uit.',
        tr: 'Kategoriler tutarlı: kendi alt kategorini basılı tutmak artık ana kategoriler gibi bir işlem menüsü açıyor (düzenle, taşı) — istenmeyen sürükleme kalktı — ve her basılı tutuş menünün geleceğini bildiren küçük bir titreşimle yanıt veriyor. Tur bunu anlatıyor.',
      },
    ],
  },
  {
    version: '2.12.2',
    date: '2026-07-18',
    items: [
      {
        en: 'Enable Banking connections work again: a low-level key-handling bug made every bank list request after the first one fail — fixed for good, with the failure reason on screen if anything else ever goes wrong. And your profile picture now survives a reinstall: the Settings header fetches it from your account instead of waiting for a re-save.',
        nl: 'Enable Banking-koppelingen werken weer: een laag-niveau sleutelfout liet elk banklijst-verzoek na het eerste mislukken — definitief opgelost, met de foutreden in beeld als er ooit iets anders misgaat. En je profielfoto overleeft nu een herinstallatie: de Instellingen-kop haalt hem uit je account in plaats van te wachten op opnieuw opslaan.',
        tr: 'Enable Banking bağlantıları yeniden çalışıyor: düşük seviyeli bir anahtar hatası ilkinden sonraki her banka listesi isteğini başarısız kılıyordu — kalıcı olarak düzeltildi; başka bir şey ters giderse nedeni ekranda. Profil fotoğrafın da artık yeniden kurulumdan sağ çıkıyor: Ayarlar başlığı yeniden kaydetmeyi beklemek yerine onu hesabından alıyor.',
      },
    ],
  },
  {
    version: '2.12.1',
    date: '2026-07-18',
    items: [
      {
        en: 'Changing your password on one device no longer traps other devices in a sign-in loop: a failed sign-in now cleans up after itself, so the next attempt starts fresh — no more deleting the app or clearing the browser to recover.',
        nl: 'Je wachtwoord wijzigen op één apparaat zet andere apparaten niet langer vast in een inloglus: een mislukte aanmelding ruimt nu zichzelf op, zodat de volgende poging schoon begint — nooit meer de app verwijderen of de browser wissen om te herstellen.',
        tr: 'Bir cihazda şifreni değiştirmek diğer cihazları artık giriş döngüsüne hapsetmiyor: başarısız bir giriş artık kendini temizliyor, böylece sonraki deneme temiz başlıyor — kurtarmak için uygulamayı silmek ya da tarayıcıyı temizlemek yok.',
      },
    ],
  },
  {
    version: '2.12.0',
    date: '2026-07-18',
    items: [
      {
        en: 'Bank connections are reliable again: a completed consent could be processed twice behind the scenes, which burned the bank\'s daily quota and made connecting look broken — it now completes exactly once, and any failure tells you the provider\'s actual reason.',
        nl: 'Bankkoppelingen zijn weer betrouwbaar: een afgeronde toestemming kon achter de schermen dubbel verwerkt worden, wat het daglimiet van de bank opbrandde en koppelen kapot deed lijken — het rondt nu precies één keer af, en elke fout vertelt de echte reden van de aanbieder.',
        tr: 'Banka bağlantıları yeniden güvenilir: tamamlanan bir onay arka planda iki kez işlenebiliyordu; bu, bankanın günlük kotasını tüketip bağlantıyı bozuk gösteriyordu — artık tam olarak bir kez tamamlanıyor ve her hata sağlayıcının gerçek nedenini söylüyor.',
      },
      {
        en: 'Give transactions your own names: rename any transaction in its detail — apply it to similar ones in one go, and munni remembers, renaming future arrivals of that merchant automatically. The bank\'s original always stays visible under Details, and predictions read your names too.',
        nl: 'Geef transacties je eigen namen: hernoem elke transactie in het detail — pas het in één keer toe op vergelijkbare, en munni onthoudt het en hernoemt toekomstige transacties van die winkel automatisch. Het origineel van de bank blijft altijd zichtbaar onder Details, en voorspellingen lezen jouw namen ook.',
        tr: 'İşlemlere kendi adlarını ver: herhangi bir işlemi detayında yeniden adlandır — benzerlerine tek seferde uygula; munni bunu hatırlar ve o satıcının gelecekteki işlemlerini otomatik yeniden adlandırır. Bankanın orijinali her zaman Detaylar altında görünür kalır ve tahminler senin adlarını da okur.',
      },
      {
        en: 'The transaction detail reorganized into calm blocks: account & type, categories (edited through the same split flow as review, starting from one category), actions, and a details block with the original amount, original title and bank data. The transactions tab\'s quick filter now surfaces Uncategorized instead of Unreviewed.',
        nl: 'De transactiedetails zijn gereorganiseerd in rustige blokken: rekening & type, categorieën (bewerkt via dezelfde splitsstroom als beoordelen, beginnend met één categorie), acties, en een detailblok met het oorspronkelijke bedrag, de oorspronkelijke titel en bankgegevens. De sneltoets in het transactietabblad toont nu Ongecategoriseerd in plaats van Onbeoordeeld.',
        tr: 'İşlem detayı sakin bloklara yeniden düzenlendi: hesap ve tür, kategoriler (incelemedeki bölüşme akışıyla, tek kategoriden başlayarak düzenlenir), işlemler ve orijinal tutar, orijinal başlık ile banka verilerini içeren detay bloğu. İşlemler sekmesindeki hızlı filtre artık İncelenmemiş yerine Kategorisiz gösteriyor.',
      },
    ],
  },
  {
    version: '2.11.0',
    date: '2026-07-18',
    items: [
      {
        en: 'Everything unfolds smoothly now: category groups, spending drill-downs and insights animate open instead of snapping, and on desktop the list gently slides aside for the detail pane instead of the page rebuilding. In review, the "also apply" bar flies along with the card.',
        nl: 'Alles klapt nu soepel uit: categoriegroepen, uitgaven-details en inzichten openen met een animatie in plaats van te knippen, en op desktop schuift de lijst rustig opzij voor het detailpaneel in plaats van dat de pagina opnieuw opbouwt. Bij beoordelen vliegt de "ook toepassen"-balk mee met de kaart.',
        tr: 'Artık her şey akıcı açılıyor: kategori grupları, harcama detayları ve içgörüler aniden değil animasyonla açılıyor; masaüstünde liste, sayfa yeniden kurulmak yerine detay paneli için usulca kenara kayıyor. İncelemede "şunlara da uygula" çubuğu kartla birlikte uçuyor.',
      },
      {
        en: 'Review will not let an "Uncategorized" slip through anymore — Confirm stays off until a real category is picked (transfers excepted). Bank logos in the connect list now come from munni\'s own server, so they load reliably, and a failed bank connection finally tells you the provider\'s actual reason.',
        nl: 'Beoordelen laat "Ongecategoriseerd" niet meer door — Bevestigen blijft uit tot een echte categorie is gekozen (behalve bij overboekingen). Banklogo\'s in de koppellijst komen nu van munni\'s eigen server en laden dus betrouwbaar, en een mislukte bankkoppeling vertelt eindelijk de echte reden van de aanbieder.',
        tr: 'İnceleme artık "Kategorisiz" olanı geçirmiyor — gerçek bir kategori seçilene kadar Onayla kapalı kalıyor (transferler hariç). Bağlantı listesindeki banka logoları artık munni\'nin kendi sunucusundan geliyor ve güvenilir yükleniyor; başarısız bir banka bağlantısı da sonunda sağlayıcının gerçek nedenini söylüyor.',
      },
      {
        en: 'The encrypted-storage beta on iPhone is fixed — a data-format quirk froze the first sync at "connecting"; it now completes. Shop logins got their own door under Settings, and category headers grew to a comfortable size.',
        nl: 'De bèta voor versleutelde opslag op iPhone is gerepareerd — een dataformaat-eigenaardigheid bevroor de eerste synchronisatie bij "verbinden"; die rondt nu af. Winkellogins kregen hun eigen ingang onder Instellingen, en categoriekoppen kregen een comfortabel formaat.',
        tr: 'iPhone\'daki şifreli depolama betası düzeltildi — bir veri biçimi tuhaflığı ilk eşitlemeyi "bağlanıyor"da donduruyordu; artık tamamlanıyor. Mağaza girişleri Ayarlar altında kendi kapısına kavuştu ve kategori başlıkları rahat bir boyuta büyüdü.',
      },
    ],
  },
  {
    version: '2.10.0',
    date: '2026-07-18',
    items: [
      {
        en: 'Review feels alive: confirmed and skipped cards fly off while the next slides in, the prediction reason sits right inside the category editor, and the whole "also apply" bar is tappable. No auto-detected subscription? Link any recurring cost to the card by hand.',
        nl: 'Beoordelen voelt levendig: bevestigde en overgeslagen kaarten vliegen weg terwijl de volgende binnenschuift, de voorspellingsreden staat direct in de categorie-editor, en de hele "ook toepassen"-balk is tikbaar. Geen automatisch herkend abonnement? Koppel elke terugkerende kostenpost handmatig aan de kaart.',
        tr: 'İnceleme canlı hissettiriyor: onaylanan ve atlanan kartlar uçup giderken sıradaki içeri kayıyor, tahmin gerekçesi doğrudan kategori düzenleyicide duruyor ve "şunlara da uygula" çubuğunun tamamı dokunulabilir. Otomatik algılanan abonelik yok mu? Herhangi bir düzenli ödemeyi karta elle bağla.',
      },
      {
        en: 'The transaction detail listens to you: a bulk recategorize now shows the affected transactions so you pick exactly which ones change, and "Customize this view" reorders or hides the reimbursement, receipt and notes sections per space.',
        nl: 'De transactiedetails luisteren naar je: bulk-hercategoriseren toont nu de geraakte transacties zodat je precies kiest welke veranderen, en "Deze weergave aanpassen" sorteert of verbergt de secties voor terugbetalingen, bonnen en notities per space.',
        tr: 'İşlem detayı seni dinliyor: toplu yeniden kategorileme artık etkilenen işlemleri gösteriyor, böylece tam olarak hangilerinin değişeceğini seçiyorsun; "Bu görünümü özelleştir" ise geri ödeme, fiş ve not bölümlerini alan başına sıralıyor veya gizliyor.',
      },
      {
        en: 'Sign-up now lets you pick your currency (the country only suggests one), split invites share as a normal https link that opens anywhere, category rows glow while you hold them, and the app heals itself after a long sleep instead of asking you to sign in again.',
        nl: 'Bij aanmelden kies je nu je valuta (het land stelt er alleen één voor), split-uitnodigingen delen als een gewone https-link die overal opent, categorierijen lichten op terwijl je ze vasthoudt, en de app herstelt zichzelf na een lange slaap in plaats van je opnieuw te laten inloggen.',
        tr: 'Kayıt olurken artık para birimini sen seçiyorsun (ülke yalnızca öneriyor), bölüşme davetleri her yerde açılan normal bir https bağlantısı olarak paylaşılıyor, kategori satırları basılı tutarken parlıyor ve uygulama uzun uykudan sonra tekrar giriş istemek yerine kendini onarıyor.',
      },
    ],
  },
  {
    version: '2.9.0',
    date: '2026-07-17',
    items: [
      {
        en: 'App flows return home again: connecting a bank brings you back into the app instead of stranding you in the browser, and signing out lands cleanly on the login screen. The encrypted-storage beta can no longer lock the app out — if it fails to open, munni falls back safely and keeps working.',
        nl: 'App-stromen komen weer thuis: een bank koppelen brengt je terug in de app in plaats van je in de browser achter te laten, en uitloggen landt netjes op het inlogscherm. De bèta voor versleutelde opslag kan de app niet meer buitensluiten — als openen mislukt, valt munni veilig terug en blijft alles werken.',
        tr: 'Uygulama akışları eve dönüyor: banka bağlamak seni tarayıcıda bırakmak yerine uygulamaya geri getiriyor ve çıkış yapmak düzgünce giriş ekranına iniyor. Şifreli depolama betası artık uygulamayı kilitleyemez — açılamazsa munni güvenle geri döner ve çalışmaya devam eder.',
      },
      {
        en: 'New: your shop logins (Albert Heijn, Jumbo) can now follow you to your other devices — end-to-end encrypted, so munni’s servers can never read them. Turn it on under Shopping connections; new devices join after you compare a 6-digit code and approve them.',
        nl: 'Nieuw: je winkellogins (Albert Heijn, Jumbo) kunnen nu meereizen naar je andere apparaten — end-to-end versleuteld, dus de servers van munni kunnen ze nooit lezen. Zet het aan onder Winkelkoppelingen; nieuwe apparaten doen mee nadat je een 6-cijferige code vergelijkt en ze goedkeurt.',
        tr: 'Yeni: mağaza girişlerin (Albert Heijn, Jumbo) artık diğer cihazlarına da gelebilir — uçtan uca şifreli, yani munni sunucuları onları asla okuyamaz. Alışveriş bağlantıları altından aç; yeni cihazlar 6 haneli kodu karşılaştırıp onaylamanla katılır.',
      },
      {
        en: 'Review reads better: the type and categories share the same larger text, and the card names the account the money left. Recurring cost payments show their dates.',
        nl: 'Beoordelen leest prettiger: het type en de categorieën delen dezelfde grotere tekst, en de kaart toont de rekening waar het geld vandaan kwam. Betalingen van terugkerende kosten tonen hun datum.',
        tr: 'İnceleme daha iyi okunuyor: tür ve kategoriler aynı büyük yazıyı paylaşıyor ve kart paranın çıktığı hesabı gösteriyor. Yinelenen gider ödemeleri tarihlerini gösteriyor.',
      },
    ],
  },
  {
    version: '2.8.0',
    date: '2026-07-17',
    items: [
      {
        en: 'PayPal purchases no longer count twice: when your PayPal account and the bank account that funds it are both connected, the funding debits automatically become transfers and the real purchase is counted once, on the PayPal side. Unmatched PayPal charges pre-select the PayPal counterparty on the review card — one tap confirms.',
        nl: 'PayPal-aankopen tellen niet langer dubbel: wanneer je PayPal-rekening en de bankrekening die haar voedt beide gekoppeld zijn, worden de afschrijvingen automatisch overboekingen en telt de echte aankoop één keer, aan de PayPal-kant. Niet-gematchte PayPal-afschrijvingen krijgen de PayPal-tegenpartij alvast voorgeselecteerd op de beoordelingskaart — één tik bevestigt.',
        tr: 'PayPal alışverişleri artık iki kez sayılmıyor: PayPal hesabın ve onu besleyen banka hesabın ikisi de bağlıyken, besleme çekimleri otomatik olarak transfere dönüşür ve gerçek alışveriş bir kez, PayPal tarafında sayılır. Eşleşmeyen PayPal çekimleri inceleme kartında PayPal karşı tarafını önceden seçili getirir — tek dokunuş onaylar.',
      },
    ],
  },
  {
    version: '2.7.0',
    date: '2026-07-17',
    items: [
      {
        en: 'The central category list is now fully manageable: when a built-in category is retired, its transactions quietly return to review as Uncategorized instead of pointing nowhere. Fresh installs ship with the latest category improvements baked in — offline profiles included.',
        nl: 'De centrale categorielijst is nu volledig beheerbaar: wanneer een ingebouwde categorie wordt uitgefaseerd, keren de transacties netjes terug naar beoordeling als Ongecategoriseerd in plaats van nergens naar te wijzen. Nieuwe installaties bevatten de nieuwste categorieverbeteringen — ook offline profielen.',
        tr: 'Merkezi kategori listesi artık tamamen yönetilebilir: yerleşik bir kategori emekli edildiğinde işlemleri hiçliğe işaret etmek yerine sessizce Kategorisiz olarak incelemeye döner. Yeni kurulumlar en güncel kategori iyileştirmeleriyle gelir — çevrimdışı profiller dahil.',
      },
    ],
  },
  {
    version: '2.6.0',
    date: '2026-07-17',
    items: [
      {
        en: 'The category screen breathes: groups start collapsed and unfold with a tap, hold a group for its actions, and the icon picker now searches the entire 7,000+ icon set — fully offline.',
        nl: 'Het categoriescherm ademt: groepen starten ingeklapt en vouwen open met een tik, houd een groep vast voor de acties, en de icoonkiezer doorzoekt nu de volledige set van 7.000+ iconen — volledig offline.',
        tr: 'Kategori ekranı ferahladı: gruplar kapalı başlar ve dokununca açılır, işlemler için gruba basılı tut, simge seçici artık 7.000+ simgenin tamamında arama yapıyor — tamamen çevrimdışı.',
      },
      {
        en: 'Desktop feels native now: pop-ups open as centered dialogs instead of side panels, transaction details close with an ✕, the list got wider, and receipts say "Upload" where there is no camera. Demo mode announces itself clearly, and the offline notice is friendlier about why munni is unreachable.',
        nl: 'Desktop voelt nu native: pop-ups openen als gecentreerde vensters in plaats van zijpanelen, transactiedetails sluiten met een ✕, de lijst werd breder, en bonnen zeggen "Uploaden" waar geen camera is. De demomodus kondigt zichzelf duidelijk aan, en de offline-melding is vriendelijker over waarom munni onbereikbaar is.',
        tr: 'Masaüstü artık yerli hissettiriyor: pencereler yan panel yerine ortalanmış diyalog olarak açılıyor, işlem detayı ✕ ile kapanıyor, liste genişledi ve kamera olmayan yerde fişler "Yükle" diyor. Demo modu kendini açıkça belli ediyor ve çevrimdışı bildirimi munni’ye neden ulaşılamadığı konusunda daha nazik.',
      },
    ],
  },
  {
    version: '2.5.0',
    date: '2026-07-17',
    items: [
      {
        en: 'The built-in category list and the import prediction rules can now be updated centrally — improvements arrive on your device with the next sync, no app update needed. Nothing changes for you today; your categories and history stay exactly as they are.',
        nl: 'De ingebouwde categorielijst en de voorspellingsregels voor imports kunnen nu centraal worden bijgewerkt — verbeteringen komen bij de volgende synchronisatie op je apparaat, zonder app-update. Er verandert vandaag niets voor jou; je categorieën en geschiedenis blijven precies zoals ze zijn.',
        tr: 'Yerleşik kategori listesi ve içe aktarma tahmin kuralları artık merkezi olarak güncellenebiliyor — iyileştirmeler bir sonraki eşitlemeyle cihazına gelir, uygulama güncellemesi gerekmez. Bugün senin için hiçbir şey değişmiyor; kategorilerin ve geçmişin olduğu gibi kalıyor.',
      },
    ],
  },
  {
    version: '2.4.0',
    date: '2026-07-17',
    items: [
      {
        en: 'Manual transactions grew up: set the type, counter account and recurring cost right in the form, and delete a manual transaction when it was a mistake. Automatically synced bank accounts no longer accept manual entries — the bank is their single source of truth.',
        nl: 'Handmatige transacties zijn volwassen geworden: stel het type, de tegenrekening en de terugkerende kosten direct in het formulier in, en verwijder een handmatige transactie als die een vergissing was. Automatisch gesynchroniseerde bankrekeningen accepteren geen handmatige invoer meer — de bank is hun enige bron van waarheid.',
        tr: 'Manuel işlemler olgunlaştı: türü, karşı hesabı ve yinelenen gideri doğrudan formda seç, yanlışlıkla eklenen manuel işlemi sil. Otomatik eşitlenen banka hesapları artık manuel giriş kabul etmiyor — tek doğruluk kaynağı banka.',
      },
      {
        en: 'Financial accounts are yours to shape: rename any account, pick your own icon, and see exactly where its data comes from (manual, file import or open banking). Signing out of the apps works cleanly again.',
        nl: 'Financiële rekeningen zijn van jou: hernoem elke rekening, kies je eigen icoon en zie precies waar de gegevens vandaan komen (handmatig, bestandsimport of open banking). Uitloggen in de apps werkt weer netjes.',
        tr: 'Finansal hesaplar senin elinde: her hesabı yeniden adlandır, kendi simgeni seç ve verilerin tam olarak nereden geldiğini gör (manuel, dosya içe aktarma veya açık bankacılık). Uygulamalardan çıkış yeniden düzgün çalışıyor.',
      },
    ],
  },
  {
    version: '2.3.0',
    date: '2026-07-17',
    items: [
      {
        en: 'iOS stability: two startup crash sources in the app are fixed, and harmless "no connection" hiccups no longer count as errors. The encrypted database engine is now built into the apps for testing.',
        nl: 'iOS-stabiliteit: twee crashbronnen bij het opstarten van de app zijn verholpen, en onschuldige "geen verbinding"-haperingen tellen niet langer als fouten. De versleutelde database-engine zit nu ter test in de apps ingebouwd.',
        tr: 'iOS kararlılığı: uygulamadaki iki açılış çökme kaynağı düzeltildi ve zararsız "bağlantı yok" takılmaları artık hata sayılmıyor. Şifreli veritabanı motoru test için uygulamalara eklendi.',
      },
    ],
  },
  {
    version: '2.2.0',
    date: '2026-07-17',
    items: [
      {
        en: 'Under the hood: the entire local database now runs behind one storage layer — the groundwork for fully encrypted storage in the iOS and Android apps. Everything works exactly as before, just future-proof.',
        nl: 'Onder de motorkap: de hele lokale database draait nu achter één opslaglaag — het fundament voor volledig versleutelde opslag in de iOS- en Android-apps. Alles werkt precies zoals eerst, maar klaar voor de toekomst.',
        tr: 'Kaputun altında: tüm yerel veritabanı artık tek bir depolama katmanının arkasında çalışıyor — iOS ve Android uygulamalarında tamamen şifreli depolamanın temeli. Her şey eskisi gibi çalışıyor, sadece geleceğe hazır.',
      },
    ],
  },
  {
    version: '2.1.0',
    date: '2026-07-17',
    items: [
      {
        en: 'The review card got its final shape: the type sits on top with its own color, every category edits through one editor (add, remove or split right there), the "why this suggestion" hides behind a small ⓘ, and the queue now runs oldest-to-newest. Transaction types wear icons and colors everywhere.',
        nl: 'De beoordelingskaart kreeg zijn definitieve vorm: het type staat bovenaan met een eigen kleur, elke categorie bewerk je via één editor (toevoegen, verwijderen of splitsen ter plekke), het "waarom deze suggestie" zit achter een kleine ⓘ, en de wachtrij loopt nu van oud naar nieuw. Transactietypes dragen overal iconen en kleuren.',
        tr: 'İnceleme kartı son halini aldı: tür kendi rengiyle üstte, her kategori tek bir düzenleyiciden geçiyor (ekle, kaldır veya orada böl), "neden bu öneri" küçük bir ⓘ arkasında ve kuyruk artık eskiden yeniye akıyor. İşlem türleri her yerde simge ve renk taşıyor.',
      },
      {
        en: 'Changing a category from the transaction detail now offers to apply it to every other transaction of that merchant — reviewed ones included. Recurring cost logos fill their whole tile, and the bulk-review sheets grew taller with a richer read-only preview.',
        nl: 'Een categorie wijzigen vanuit de transactiedetails biedt nu aan die toe te passen op elke andere transactie van die winkel — ook beoordeelde. Logo\'s van terugkerende kosten vullen hun hele tegel, en de bulkbeoordelingsvellen werden hoger met een rijker alleen-lezen voorbeeld.',
        tr: 'İşlem detayından kategori değiştirmek artık o satıcının diğer tüm işlemlerine uygulamayı öneriyor — incelenmişler dahil. Yinelenen gider logoları karelerini tamamen dolduruyor ve toplu inceleme sayfaları daha uzun, daha zengin bir önizlemeyle geldi.',
      },
    ],
  },
  {
    version: '2.0.0',
    date: '2026-07-17',
    items: [
      {
        en: 'Counterparties got smarter: set one yourself when the bank left it empty (the account suggests the type — savings → saving, your credit card → transfer), and connecting a new account automatically links every old transaction that pointed at it.',
        nl: 'Tegenpartijen zijn slimmer: stel er zelf een in wanneer de bank het leeg liet (de rekening stelt het type voor — spaarrekening → sparen, je creditcard → overboeking), en een nieuwe rekening koppelen verbindt automatisch elke oude transactie die ernaar wees.',
        tr: 'Karşı taraflar akıllandı: banka boş bıraktığında kendin seç (hesap türü öneriyor — birikim → birikim, kredi kartın → transfer) ve yeni bir hesap bağlamak ona işaret eden tüm eski işlemleri otomatik bağlar.',
      },
      {
        en: 'Category names now stay tidy: no duplicate main categories, no subcategory that borrows a main\'s name, and no twins inside one parent — the same rules guard drag & drop. Account deletion moved into Global settings, safely away from Sign out.',
        nl: 'Categorienamen blijven netjes: geen dubbele hoofdcategorieën, geen subcategorie met de naam van een hoofdcategorie, en geen tweelingen binnen één hoofdcategorie — dezelfde regels gelden bij slepen. Account verwijderen verhuisde naar Algemene instellingen, veilig weg van Uitloggen.',
        tr: 'Kategori adları düzenli kalıyor: yinelenen ana kategori yok, ana kategori adını alan alt kategori yok, aynı ebeveynde ikiz yok — aynı kurallar sürüklemede de geçerli. Hesap silme, Çıkış yapmadan güvenle uzağa, Genel ayarlara taşındı.',
      },
      {
        en: 'Android fixes: the notification toggle no longer forgets itself after the app is closed, and the user guide opens properly in the app.',
        nl: 'Android-fixes: de meldingenschakelaar vergeet zichzelf niet meer na het sluiten van de app, en de gebruikersgids opent nu goed in de app.',
        tr: 'Android düzeltmeleri: bildirim anahtarı uygulama kapatıldıktan sonra artık kendini unutmuyor ve kullanım kılavuzu uygulamada düzgün açılıyor.',
      },
    ],
  },
  {
    version: '1.24.0',
    date: '2026-07-16',
    items: [
      {
        en: 'The Android/iOS apps feel more at home: long-press the app icon for Review or Transactions shortcuts, exports open the system share sheet (straight to Files or mail), a subtle haptic confirms each review, and tapping a notification lands you on the right screen.',
        nl: 'De Android/iOS-apps voelen meer thuis: houd het app-icoon ingedrukt voor Beoordelen- of Transacties-snelkoppelingen, exports openen het systeemdeelmenu (direct naar Bestanden of mail), een subtiele triltik bevestigt elke beoordeling, en een tik op een melding brengt je naar het juiste scherm.',
        tr: 'Android/iOS uygulamaları daha yerli hissettiriyor: uygulama simgesine uzun bas ve İncele veya İşlemler kısayollarını aç; dışa aktarmalar sistem paylaşım menüsünü açar (doğrudan Dosyalar veya e-posta), her incelemeyi hafif bir titreşim onaylar ve bildirime dokunmak seni doğru ekrana götürür.',
      },
    ],
  },
  {
    version: '1.23.0',
    date: '2026-07-16',
    items: [
      {
        en: 'Money you move between your own accounts — say, topping up your credit card — is recognized in review and pre-marked as a transfer instead of counting as spending. One tap opts out.',
        nl: 'Geld dat je tussen je eigen rekeningen verplaatst — bijvoorbeeld je creditcard aanvullen — wordt in review herkend en alvast als overboeking gemarkeerd in plaats van als uitgave geteld. Eén tik zet het terug.',
        tr: 'Kendi hesapların arasında taşıdığın para — örneğin kredi kartına yükleme — incelemede tanınır ve harcama sayılmak yerine transfer olarak önceden işaretlenir. Tek dokunuşla geri alınır.',
      },
      {
        en: 'Splits moved into the space settings where the rest of your tools live, and Home gained a Splits block showing your current split and who owes whom. Recurring and Portfolio now share the same big left-aligned header as Home.',
        nl: 'Splits verhuisde naar de ruimte-instellingen bij je andere tools, en Home kreeg een Splits-blok met je huidige split en wie wie wat schuldig is. Terugkerend en Portfolio hebben nu dezelfde grote kop als Home.',
        tr: 'Bölüşmeler diğer araçlarının yanına, alan ayarlarına taşındı; Ana sayfaya mevcut bölüşmeni ve kimin kime borçlu olduğunu gösteren bir Bölüşmeler bloğu eklendi. Yinelenen ve Portföy artık Ana sayfayla aynı büyük başlığı kullanıyor.',
      },
    ],
  },
  {
    version: '1.22.0',
    date: '2026-07-16',
    items: [
      {
        en: 'The app lock in the Android/iOS apps now uses the real Face ID / fingerprint prompt from your device instead of the browser fallback. Your PIN keeps working everywhere.',
        nl: 'De app-vergrendeling in de Android/iOS-apps gebruikt nu de echte Face ID / vingerafdruk-prompt van je toestel in plaats van de browser-fallback. Je pincode blijft overal werken.',
        tr: 'Android/iOS uygulamalarındaki uygulama kilidi artık tarayıcı yedeği yerine cihazının gerçek Face ID / parmak izi istemini kullanıyor. PIN kodun her yerde çalışmaya devam ediyor.',
      },
    ],
  },
  {
    version: '1.21.0',
    date: '2026-07-16',
    items: [
      {
        en: 'Splits meet events: link a split to one of your own events and expenses you pick from your transactions join the event automatically. The event page shows "you\'re owed…" at a glance, and review recognizes a friend\'s repayment and offers to mark it as a transfer.',
        nl: 'Splits en gebeurtenissen: koppel een split aan een eigen gebeurtenis en uitgaven die je uit je transacties kiest gaan er automatisch bij. De gebeurtenispagina toont in één oogopslag "je krijgt…", en review herkent een terugbetaling van een vriend en biedt aan die als overboeking te markeren.',
        tr: 'Bölüşmeler etkinliklerle buluştu: bir bölüşmeyi kendi etkinliğine bağla; işlemlerinden seçtiğin harcamalar etkinliğe otomatik eklenir. Etkinlik sayfası "alacaklısın…" bilgisini tek bakışta gösterir; inceleme, arkadaşının geri ödemesini tanıyıp transfer olarak işaretlemeyi önerir.',
      },
    ],
  },
  {
    version: '1.20.0',
    date: '2026-07-16',
    items: [
      {
        en: 'Splits settle up: a Settle button next to "you owe…" records the payment in one tap, and the owner can close a finished split — locking it for everyone.',
        nl: 'Splits verrekenen: een Verreken-knop naast "jij bent … schuldig" legt de betaling in één tik vast, en de eigenaar kan een afgeronde split afsluiten — vergrendeld voor iedereen.',
        tr: 'Bölüşmelerde hesap kapama: "borçlusun…" satırındaki Öde düğmesi ödemeyi tek dokunuşla kaydeder; sahibi biten bölüşmeyi kapatabilir — herkes için kilitlenir.',
      },
    ],
  },
  {
    version: '1.19.0',
    date: '2026-07-16',
    items: [
      {
        en: 'Splits go social: invite anyone with one share link — no friendship needed. Joiners pick which of their own spaces the split attaches to, and members only ever see the split itself, never anyone\'s accounts or transactions. There\'s a short tour under Help & tutorials.',
        nl: 'Splits worden sociaal: nodig iedereen uit met één deellink — vriendschap niet nodig. Wie joint kiest aan welke eigen ruimte de split wordt gekoppeld, en leden zien alleen de split zelf, nooit iemands rekeningen of transacties. Er staat een korte tour onder Help & tutorials.',
        tr: 'Bölüşmeler sosyalleşti: tek paylaşım bağlantısıyla herkesi davet et — arkadaşlık gerekmez. Katılanlar bölüşmenin kendi hangi alanına bağlanacağını seçer; üyeler yalnızca bölüşmeyi görür, kimsenin hesaplarını veya işlemlerini asla. Yardım ve eğitimler altında kısa bir tur var.',
      },
    ],
  },
  {
    version: '1.18.0',
    date: '2026-07-16',
    items: [
      {
        en: 'New: Splits — settle up with any group. Create a split under Settings → Splits, add who paid what (typed in, or picked straight from your own transactions), adjust shares when a split isn\'t fifty-fifty, and munni works out who owes whom with the fewest transfers. Inviting others is coming next.',
        nl: 'Nieuw: Splits — verreken met elke groep. Maak een split aan onder Instellingen → Splits, voeg toe wie wat betaalde (getypt of direct uit je eigen transacties gekozen), pas aandelen aan als het niet fifty-fifty is, en munni rekent uit wie wie wat schuldig is met zo min mogelijk overboekingen. Anderen uitnodigen volgt binnenkort.',
        tr: 'Yeni: Bölüşmeler — her grupla hesaplaş. Ayarlar → Bölüşmeler altında bir bölüşme oluştur, kimin ne ödediğini ekle (elle yaz veya doğrudan kendi işlemlerinden seç), eşit olmayan bölüşmelerde payları ayarla; munni en az transferle kimin kime ne borçlu olduğunu hesaplar. Başkalarını davet etme sırada.',
      },
    ],
  },
  {
    version: '1.17.0',
    date: '2026-07-16',
    items: [
      {
        en: 'You can now delete your account entirely — Settings → Delete account. Bank access is revoked at the provider, shared spaces stay intact for their members, and everything else is erased immediately.',
        nl: 'Je kunt je account nu volledig verwijderen — Instellingen → Account verwijderen. Banktoegang wordt bij de provider ingetrokken, gedeelde ruimtes blijven intact voor hun leden, en al het andere wordt direct gewist.',
        tr: 'Artık hesabını tamamen silebilirsin — Ayarlar → Hesabı sil. Banka erişimi sağlayıcıda iptal edilir, paylaşılan alanlar üyeleri için korunur ve geri kalan her şey anında silinir.',
      },
      {
        en: 'Behind the scenes: a redesigned operator console keeps an eye on bank-connection quotas and expiring consents, so syncs stay healthy.',
        nl: 'Achter de schermen: een vernieuwde beheerconsole bewaakt bankverbindingsquota en verlopende toestemmingen, zodat synchronisaties gezond blijven.',
        tr: 'Perde arkasında: yenilenen yönetim konsolu banka bağlantı kotalarını ve süresi dolan izinleri izliyor; senkronizasyonlar sağlıklı kalıyor.',
      },
    ],
  },
  {
    version: '1.15.0',
    date: '2026-07-16',
    items: [
      {
        en: 'The transaction type has its own row in the detail now — see it, tap it, change it (a mismatching category moves to Uncategorized for review).',
        nl: 'Het transactietype heeft nu een eigen regel in het detail — zie het, tik erop, wijzig het (een niet-passende categorie verhuist naar Niet gecategoriseerd ter controle).',
        tr: 'İşlem türünün artık detayda kendi satırı var — gör, dokun, değiştir (uymayan kategori incelenmek üzere Kategorisiz\'e taşınır).',
      },
      {
        en: 'The apps take real receipt photos with the camera, tell you right on Home when a newer version is in the store, and theme & language can follow your device.',
        nl: 'De apps maken nu echte bonnetjesfoto\'s met de camera, melden op Home wanneer er een nieuwere versie in de store staat, en thema & taal kunnen je toestel volgen.',
        tr: 'Uygulamalar artık kamerayla gerçek fiş fotoğrafı çekiyor, mağazada yeni sürüm olduğunda Ana sayfada söylüyor ve tema ile dil cihazını takip edebiliyor.',
      },
      {
        en: 'Raw bank data (like invoice numbers) sits in its own tidy "Bank details" block, and signing out of the apps returns you to the app instead of a browser error.',
        nl: 'Ruwe bankgegevens (zoals factuurnummers) staan in een eigen net "Bankgegevens"-blok, en uitloggen in de apps brengt je terug naar de app in plaats van een browserfout.',
        tr: 'Ham banka verileri (fatura numarası gibi) artık düzenli bir "Banka bilgileri" bloğunda ve uygulamalardan çıkış artık tarayıcı hatası yerine uygulamaya döndürüyor.',
      },
    ],
  },
  {
    version: '1.13.0',
    date: '2026-07-16',
    items: [
      {
        en: 'munni is now a real app: Android (Play internal testing) and iOS (TestFlight), with login, sync and push — and your data on the device is never wiped by the OS.',
        nl: 'munni is nu een echte app: Android (Play interne test) en iOS (TestFlight), met inloggen, sync en meldingen — en je gegevens op het toestel worden nooit meer door het OS gewist.',
        tr: 'munni artık gerçek bir uygulama: Android (Play dahili test) ve iOS (TestFlight); giriş, senkronizasyon ve bildirimlerle — cihazdaki verilerin artık işletim sistemi tarafından silinmiyor.',
      },
      {
        en: 'Reimbursements got honest: income can settle expenses too, and category totals now reflect what things really cost — budgets, trends and drill-downs all agree.',
        nl: 'Vergoedingen zijn nu eerlijk: inkomsten kunnen ook uitgaven vereffenen, en categorietotalen tonen wat dingen echt kostten — budgetten, trends en uitsplitsingen kloppen allemaal.',
        tr: 'Geri ödemeler dürüstleşti: gelirler de giderleri kapatabiliyor ve kategori toplamları artık gerçek maliyeti gösteriyor — bütçeler, eğilimler ve dökümler hepsi tutarlı.',
      },
      {
        en: 'Review, refined: long bank descriptions expand on tap, and "also apply to similar" opens a full list where every transaction shows its details.',
        nl: 'Beoordelen, verfijnd: lange bankomschrijvingen klappen uit bij een tik, en "ook toepassen op vergelijkbare" opent een volledige lijst waar elke transactie zijn details toont.',
        tr: 'İnceleme inceldi: uzun banka açıklamaları dokununca açılıyor; "benzerlerine de uygula" artık her işlemin detayını gösteren tam bir liste açıyor.',
      },
      {
        en: '"Safe to spend" shows its math as a colored bar — bills before payday, money already assigned, and what is truly free.',
        nl: '"Vrij te besteden" toont zijn rekensom als gekleurde balk — vaste lasten vóór betaaldag, al toegewezen geld, en wat echt vrij is.',
        tr: '"Harcanabilir" hesabını renkli bir çubukla gösteriyor — maaş öncesi faturalar, ayrılmış para ve gerçekten serbest olan.',
      },
      {
        en: 'Split transactions pick smarter icons, brand logos got bigger, the demo profile shows every feature in action, and munni speaks your device language on first launch.',
        nl: 'Gesplitste transacties kiezen slimmere iconen, merklogo\'s werden groter, het demoprofiel toont elke functie in actie, en munni spreekt bij de eerste start de taal van je toestel.',
        tr: 'Bölünmüş işlemler daha akıllı simgeler seçiyor, marka logoları büyüdü, demo profili her özelliği iş başında gösteriyor ve munni ilk açılışta cihazının dilini konuşuyor.',
      },
    ],
  },
  {
    version: '1.6.0',
    date: '2026-07-15',
    items: [
      {
        en: 'Trends: monthly bars per category, income vs expenses, and your net worth over time — under Settings → Trends, with an optional Home block.',
        nl: 'Trends: maandbalken per categorie, inkomsten vs uitgaven en je vermogen door de tijd — onder Instellingen → Trends, met een optioneel Home-blok.',
        tr: 'Eğilimler: kategori başına aylık çubuklar, gelir-gider karşılaştırması ve zaman içinde net varlığın — Ayarlar → Eğilimler altında, isteğe bağlı Ana ekran bloğuyla.',
      },
      {
        en: '"Safe to spend": Home can now tell you what is really free until payday — liquid balance minus upcoming fixed costs and allocation promises, with a transparent breakdown.',
        nl: '"Vrij te besteden": Home vertelt nu wat er echt vrij is tot je betaaldag — saldo minus komende vaste lasten en allocatiebeloften, met een transparante uitsplitsing.',
        tr: '"Harcanabilir": Ana ekran maaş gününe kadar gerçekte neyin serbest olduğunu söylüyor — bakiye eksi yaklaşan sabit giderler ve tahsisler, şeffaf dökümüyle.',
      },
      {
        en: 'Subscriptions show their yearly cost everywhere, and a sustained price change (hello, streaming services) badges itself with the damage per year.',
        nl: 'Abonnementen tonen overal hun jaarkosten, en een blijvende prijsverhoging (hallo, streamingdiensten) meldt zichzelf met de schade per jaar.',
        tr: 'Abonelikler her yerde yıllık maliyetini gösteriyor; kalıcı bir zam kendini yıllık etkisiyle birlikte rozetliyor.',
      },
      {
        en: 'Export your data: CSV (Excel-ready) or a JSON backup, straight from Global settings — everything stays on your device.',
        nl: 'Exporteer je gegevens: CSV (klaar voor Excel) of een JSON-back-up, rechtstreeks vanuit Algemene instellingen — alles blijft op je apparaat.',
        tr: 'Verilerini dışa aktar: CSV (Excel uyumlu) veya JSON yedeği, doğrudan Genel ayarlardan — her şey cihazında kalır.',
      },
    ],
  },
  {
    version: '1.5.0',
    date: '2026-07-15',
    items: [
      {
        en: 'New categories: parking, bikes, telecom, work lunches, apps & software, outdoor & nature, insurance, kids & clubs — and you can hide whole category groups per space from Manage categories.',
        nl: 'Nieuwe categorieën: parkeren, fiets, telecom, werklunch, apps & software, buiten & natuur, verzekering, kinderen & clubs — en hele categoriegroepen zijn per space te verbergen via Categorieën beheren.',
        tr: 'Yeni kategoriler: otopark, bisiklet, telekom, iş yemeği, uygulama & yazılım, doğa & açık hava, sigorta, çocuklar & kulüpler — ayrıca kategori gruplarını alan başına gizleyebilirsin.',
      },
      {
        en: 'Big screens got a real overhaul: a full-screen sign-in backdrop, denser transaction rows with the account visible, a focused review layout, and keyboard shortcuts (Enter confirms, arrows skip, Esc closes, / searches).',
        nl: 'Grote schermen kregen een echte opknapbeurt: inloggen met achtergrond over het hele scherm, compactere transactieregels met de rekening zichtbaar, een gefocuste beoordelingsweergave en sneltoetsen (Enter bevestigt, pijltjes slaan over, Esc sluit, / zoekt).',
        tr: 'Büyük ekranlar gerçek bir yenileme aldı: tam ekran giriş arka planı, hesabı görünen daha yoğun işlem satırları, odaklı inceleme düzeni ve klavye kısayolları (Enter onaylar, oklar atlar, Esc kapatır, / arar).',
      },
      {
        en: 'You can now leave a shared space from its settings — you immediately lose access to the accounts attached there. And every bank account shows when it last synced.',
        nl: 'Je kunt een gedeelde space nu verlaten via de instellingen — je verliest direct toegang tot de gekoppelde rekeningen. En elke bankrekening toont wanneer die voor het laatst is gesynct.',
        tr: 'Paylaşılan bir alandan artık ayarlarından ayrılabilirsin — oraya bağlı hesaplara erişimin anında kalkar. Ayrıca her banka hesabı en son ne zaman eşitlendiğini gösteriyor.',
      },
      {
        en: 'Reimbursements got smarter: link from the incoming payment too, amounts net out on both sides, and a fully-used refund files itself under Reimbursement.',
        nl: 'Terugbetalingen zijn slimmer: koppelen kan nu ook vanaf de inkomende betaling, bedragen worden aan beide kanten verrekend, en een volledig gebruikte terugbetaling zet zichzelf onder Terugbetaling.',
        tr: 'Geri ödemeler akıllandı: gelen ödemeden de bağlayabilirsin, tutarlar iki tarafta da netleşir ve tamamen kullanılmış bir iade kendini Geri ödeme kategorisine yazar.',
      },
      {
        en: 'Jumbo receipts: their servers block outside connections for now, and the app says so honestly instead of failing silently — photo receipts still work.',
        nl: 'Jumbo-bonnetjes: hun servers blokkeren nu externe verbindingen en de app zegt dat eerlijk in plaats van stil te falen — foto-bonnetjes werken gewoon.',
        tr: 'Jumbo fişleri: sunucuları şu an dış bağlantıları engelliyor ve uygulama bunu sessizce hata vermek yerine dürüstçe söylüyor — fotoğraf fişleri çalışmaya devam ediyor.',
      },
    ],
  },
  {
    version: '1.4.0',
    date: '2026-07-14',
    items: [
      {
        en: 'Portfolio has its own tab, and the Home blocks follow a new order — long-press-free reordering stays in Customize Home.',
        nl: 'Portefeuille heeft een eigen tab en de blokken op Home volgen een nieuwe volgorde — herschikken kan nog steeds via Home aanpassen.',
        tr: 'Portföy artık kendi sekmesinde ve Ana ekran blokları yeni bir sırada — yeniden sıralama Ana ekranı özelleştir bölümünde.',
      },
      {
        en: 'Reviewing is calmer: everything you pick stays a draft until you hit Confirm, splits clear on tap, and the full bank description is one tap away.',
        nl: 'Beoordelen is rustiger: alles wat je kiest blijft een concept tot je op Bevestigen tikt, splitsingen wissen bij aantikken en de volledige omschrijving is één tik weg.',
        tr: 'İnceleme daha sakin: seçtiklerin Onayla diyene kadar taslak kalır, bölüşümler dokununca temizlenir ve tam açıklama tek dokunuş uzakta.',
      },
      {
        en: 'Receipts got their own home: grouped by store, searchable by item or amount, and store connections can be shared per space.',
        nl: 'Bonnetjes hebben een eigen plek: gegroepeerd per winkel, doorzoekbaar op artikel of bedrag, en winkelkoppelingen zijn per space te delen.',
        tr: 'Fişlerin artık kendi yeri var: mağazaya göre gruplu, ürüne veya tutara göre aranabilir; mağaza bağlantıları alan başına paylaşılabilir.',
      },
      {
        en: 'Banks can sync more than once a day, reserved card payments show up with a badge, and PayPal connections work now.',
        nl: 'Banken kunnen vaker dan één keer per dag synchroniseren, gereserveerde betalingen krijgen een badge en PayPal-koppelingen werken nu.',
        tr: 'Bankalar günde birden çok kez eşitlenebilir, rezerve ödemeler rozetle görünür ve PayPal bağlantıları artık çalışıyor.',
      },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-07-10',
    items: [
      {
        en: 'The transaction list and its detail sit side by side on wide screens.',
        nl: 'De transactielijst en het detail staan naast elkaar op brede schermen.',
        tr: 'Geniş ekranlarda işlem listesi ve detayı yan yana durur.',
      },
      {
        en: 'Settings split into space-scoped and global sections.',
        nl: 'Instellingen zijn gesplitst in space-gebonden en algemene onderdelen.',
        tr: 'Ayarlar alana özgü ve genel bölümlere ayrıldı.',
      },
    ],
  },
];

const SEEN_KEY = 'whatsNewSeenVersion';

export const latestWhatsNewVersion = (): string | undefined => WHATS_NEW[0]?.version;

/** true while the newest entry hasn't been acknowledged on this device */
export function useWhatsNewUnseen(): boolean {
  const { store } = useData();
  const seen = useQuery(store, async () => (await store.metaGet(SEEN_KEY)) ?? null, []);
  if (seen === undefined) return false; // still loading — don't flash
  const latest = latestWhatsNewVersion();
  return !!latest && seen?.value !== latest;
}

export function useMarkWhatsNewSeen(): () => void {
  const { store } = useData();
  return () => {
    const latest = latestWhatsNewVersion();
    if (latest) void store.metaPut(SEEN_KEY, latest);
  };
}
