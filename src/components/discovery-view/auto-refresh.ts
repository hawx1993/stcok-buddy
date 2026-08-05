export function shouldAutoRefreshDiscoverySnapshot(
  displayedTradeDate: string,
  tradeDateOptions: Array<{ date: string }>,
) {
  const latestTradeDate = tradeDateOptions.reduce(
    (latest, item) => (item.date > latest ? item.date : latest),
    '',
  );
  return !displayedTradeDate || !latestTradeDate || displayedTradeDate === latestTradeDate;
}

export function shouldRefreshActiveDiscoverySections(
  shouldAutoRefresh: boolean,
  pageVisible: boolean,
  activeSectionCount: number,
) {
  return shouldAutoRefresh && pageVisible && activeSectionCount > 0;
}
