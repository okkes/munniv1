// Main app — composes nav + screens inside the iOS frame

const SCREEN_REGISTRY = {
  txDetail:       ({params}) => <ScreenTxDetail params={params}/>,
  expenses:       () => <ScreenExpenses/>,
  categoryDrill:  ({params}) => <ScreenCategoryDrill params={params}/>,
  linkReimburse:  ({params}) => <ScreenLinkReimburse params={params}/>,
  search:         () => <ScreenStub title="Search"/>,
  sync:           () => <ScreenStub title="Sync"/>,
  notifications:  () => <ScreenStub title="Notifications"/>,
  budgets:        () => <ScreenBudgets/>,
  budgetDetail:   ({params}) => <ScreenBudgetDetail params={params}/>,
  budgetCreate:   () => <ScreenBudgetCreate/>,
  goals:          () => <ScreenGoals/>,
  goalDetail:     ({params}) => <ScreenGoalDetail params={params}/>,
  reviewSwipe:    () => <ScreenReviewSwipe/>,
  allocate:       () => <ScreenAllocate/>,
  allocateTopic:  ({params}) => <ScreenAllocateTopic params={params}/>,
  investment:     () => <ScreenInvestment/>,
  investmentConnect: () => <ScreenInvestmentConnect/>,
  eventDetail:    ({params}) => <ScreenEventDetail params={params}/>,
  eventCreate:    () => <ScreenEventCreate/>,
  recurring:      () => <ScreenRecurring/>,
  accounts:       () => <ScreenAccounts/>,
  settings:       () => <ScreenSettings/>,
};

function TabRoot() {
  const nav = useNav();
  if (nav.tab === 'home') return <ScreenHome/>;
  if (nav.tab === 'tx') return <ScreenTransactions/>;
  if (nav.tab === 'events') return <ScreenEvents/>;
  if (nav.tab === 'profile') return <ScreenProfile/>;
  return null;
}

function Router() {
  const nav = useNav();
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: M.paper, overflow: 'hidden' }}>
      <TabRoot/>
      {nav.stack.map((entry, i) => {
        const Comp = SCREEN_REGISTRY[entry.screen];
        if (!Comp) return null;
        return (
          <div key={i} style={{
            position: 'absolute', inset: 0, background: M.paper,
            animation: 'mSlideIn 0.28s cubic-bezier(.2,.7,.2,1) both',
          }}>
            <Comp params={entry.params}/>
          </div>
        );
      })}
    </div>
  );
}

function App() {
  return (
    <IOSDevice color="silver">
      <NavProvider initial="home">
        <div className="m m-app" style={{ width: '100%', height: '100%', background: M.paper }}>
          <Router/>
        </div>
      </NavProvider>
    </IOSDevice>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App/>);
