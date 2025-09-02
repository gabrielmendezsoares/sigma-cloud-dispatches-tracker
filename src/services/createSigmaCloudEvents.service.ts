import momentTimezone from 'moment-timezone';
import { PrismaClient } from '@prisma/client/storage/client.js'
import { HttpClientUtil, loggerUtil, BearerStrategy } from '../../expressium/index.js';
import { IAccountMap, ICompanyMap, IDispatchMap } from './interfaces/index.js';

const DISPATCHES_PERIOD_DAYS = 3;
const DISPATCHES_TOTAL_COUNT_THRESHOLD = 4;
const AUXILIARY = '0';
const EVENT_CODE = 'E701';
const EVENT_ID = '167629000';
const PARTITION = '000';
const PROTOCOL_TYPE = 'CONTACT_ID';

const prisma = new PrismaClient();

export const createSigmaCloudEvents = async (): Promise<any> => {
  const httpClientInstance = new HttpClientUtil.HttpClient();

  httpClientInstance.setAuthenticationStrategy(new BearerStrategy.BearerStrategy(process.env.SIGMA_CLOUD_BEARER_TOKEN as string));

  try {
    const companyMapList = await httpClientInstance.get<ICompanyMap.ICompanyMap[]>('https://api.segware.com.br/v1/companies');

    Promise.allSettled(
      companyMapList.data.map(
        async (companyMap: ICompanyMap.ICompanyMap): Promise<void> => {
          const utcCurrent = momentTimezone().utc();
          const dispatchMapList = await httpClientInstance.get<IDispatchMap.IDispatchMap[]>(`https://api.segware.com.br/v1/dispatches?companyId=${ companyMap.id }&startDate=${ utcCurrent.clone().subtract(DISPATCHES_PERIOD_DAYS, 'days').format('YYYY-MM-DD') }&endDate=${ utcCurrent.format('YYYY-MM-DD') }`);
          
          await Promise.allSettled(
            dispatchMapList.data.map(
              async (dispatchMap: IDispatchMap.IDispatchMap): Promise<void> => {
                let totalCount = 0;
        
                Object.values(dispatchMap.dispatches).forEach(
                  (count: number): void => {
                    totalCount += count;
                  }
                );
        
                const sigmaCloudDispatchesTrackerTrigger = await prisma.sigma_cloud_dispatches_tracker_triggers.findUnique({ where: { account_id: dispatchMap.account.id } });

                if (totalCount >= DISPATCHES_TOTAL_COUNT_THRESHOLD) {
                  if (sigmaCloudDispatchesTrackerTrigger) {
                    if (sigmaCloudDispatchesTrackerTrigger.quantity >= totalCount) {
                      return;
                    }

                    await prisma.sigma_cloud_dispatches_tracker_triggers.update(
                      {
                        where: { account_id: dispatchMap.account.id },
                        data: { quantity: totalCount },
                      }
                    );
                  } else {
                    await prisma.sigma_cloud_dispatches_tracker_triggers.create(
                      {
                        data: { 
                          account_id: dispatchMap.account.id, 
                          quantity: totalCount 
                        }
                      }
                    );
                  }

                  const accountMap = (await httpClientInstance.get<IAccountMap.IAccountMap>(`https://api.segware.com.br/v5/accounts/${ dispatchMap.account.id }`)).data;
        
                  try {
                    await httpClientInstance.post<unknown>(
                      'https://api.segware.com.br/v3/events/alarm', 
                      { 
                        events: [
                          {
                            account: accountMap.accountCode,
                            auxiliary: AUXILIARY,
                            code: EVENT_CODE,
                            companyId: accountMap.companyId,
                            complement: `Advertência: Excesso de deslocamentos detectado, Total de deslocamentos: ${ totalCount } no período de ${ DISPATCHES_PERIOD_DAYS } dias.`,
                            eventId: EVENT_ID,
                            eventLog: `Advertência: Excesso de deslocamentos detectado, Total de deslocamentos: ${ totalCount } no período de ${ DISPATCHES_PERIOD_DAYS } dias.`,
                            partition: PARTITION,
                            protocolType: PROTOCOL_TYPE
                          }
                        ]
                      }
                    );
        
                    await prisma.sigma_cloud_alarm_events.create(
                      {
                        data: {
                          application_type: 'sigma-cloud-dispatches-tracker',
                          account: accountMap.accountCode,
                          auxiliary: AUXILIARY,
                          code: EVENT_CODE,
                          company_id: accountMap.companyId,
                          complement: `Advertência: Excesso de deslocamentos detectado, Total de deslocamentos: ${ totalCount } no período de ${ DISPATCHES_PERIOD_DAYS } dias.`,
                          event_id: EVENT_ID,
                          event_log: `Advertência: Excesso de deslocamentos detectado, Total de deslocamentos: ${ totalCount } no período de ${ DISPATCHES_PERIOD_DAYS } dias.`,
                          partition: PARTITION,
                          protocol_type: PROTOCOL_TYPE,
                          status: 'sent'
                        }
                      }
                    );
                  } catch (error: unknown) {
                    loggerUtil.error(error instanceof Error ? error.message : String(error));
                    
                    await prisma.sigma_cloud_alarm_events.create(
                      {
                        data: {
                          application_type: 'sigma-cloud-dispatches-tracker',
                          account: accountMap.accountCode,
                          auxiliary: AUXILIARY,
                          code: EVENT_CODE,
                          company_id: accountMap.companyId,
                          complement: `Advertência: Excesso de deslocamentos detectado, Total de deslocamentos: ${ totalCount } no período de ${ DISPATCHES_PERIOD_DAYS } dias.`,
                          event_id: EVENT_ID,
                          event_log: `Advertência: Excesso de deslocamentos detectado, Total de deslocamentos: ${ totalCount } no período de ${ DISPATCHES_PERIOD_DAYS } dias.`,
                          partition: PARTITION,
                          protocol_type: PROTOCOL_TYPE,
                          status: 'failed'
                        }
                      }
                    );
                  }
                } else if (sigmaCloudDispatchesTrackerTrigger) {
                  await prisma.sigma_cloud_dispatches_tracker_triggers.delete({ where: { account_id: dispatchMap.account.id } });
                }
              }
            )
          );
        }
      )
    );
  } catch (error: any) {
    loggerUtil.error(error instanceof Error ? error.message : String(error));
  }
};
