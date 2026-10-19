import { StellarService, CONTRACT_EVENT_PAGE_LIMIT } from './stellar.service';

describe('StellarService.fetchContractEvents', () => {
  it('uses the last event paging token instead of startLedger for the next page', async () => {
    const service = new StellarService({} as any);
    const getEvents = jest.fn().mockResolvedValue({ latestLedger: 500, events: [] });
    (service as any).rpcClient = { getEvents };
    (service as any).contractId = 'CONTRACT';

    await service.fetchContractEvents(490);
    await service.fetchContractEvents(501, 'token-99');

    expect(getEvents).toHaveBeenNthCalledWith(1, {
      startLedger: 490,
      filters: [{ type: 'contract', contractIds: ['CONTRACT'] }],
      limit: CONTRACT_EVENT_PAGE_LIMIT,
    });
    expect(getEvents).toHaveBeenNthCalledWith(2, {
      cursor: 'token-99',
      filters: [{ type: 'contract', contractIds: ['CONTRACT'] }],
      limit: CONTRACT_EVENT_PAGE_LIMIT,
    });
  });
});
