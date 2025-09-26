import momentTimezone from 'moment-timezone';
import { PrismaClient } from '@prisma/client/storage/client.js'
import { HttpClientUtil, loggerUtil, BearerStrategy } from '../../expressium/index.js';
import { IAccountMap, IClientGroupMap, ICompanyMap, IDispatchMap } from './interfaces/index.js';

const DISPATCHES_PERIOD_DAYS = 3;
const DISPATCHES_PERIOD_MILLISECONDS = momentTimezone.duration(DISPATCHES_PERIOD_DAYS, 'days').asMilliseconds();
const DISPATCHES_COUNT_THRESHOLD = 3;
const ACCOUNT_TRADE_NAME_LENGTH = 14;
const AUXILIARY = '0';
const EVENT_CODE = 'E701';
const EVENT_ID = '167629000';
const PARTITION = '000';
const PROTOCOL_TYPE = 'CONTACT_ID';

const prisma = new PrismaClient();

export const createSigmaCloudEvents = async (): Promise<void> => {  
  try {
    let sigmaCloudDispatchesTrackerWindow = await prisma.sigma_cloud_dispatches_tracker_window.findFirst();

    if (!sigmaCloudDispatchesTrackerWindow || momentTimezone.utc().isAfter(momentTimezone.utc(sigmaCloudDispatchesTrackerWindow.started_at).add(DISPATCHES_PERIOD_MILLISECONDS, 'milliseconds')))  {
      await prisma.sigma_cloud_dispatches_tracker_window.deleteMany();
      
      sigmaCloudDispatchesTrackerWindow = await prisma.sigma_cloud_dispatches_tracker_window.create({ data: { id: 1 } });
    }

    await prisma.sigma_cloud_dispatches_tracker_triggers.deleteMany({ where: { updated_at: { lt: sigmaCloudDispatchesTrackerWindow.created_at } } });

    const sigmaCloudHttpClientInstance = new HttpClientUtil.HttpClient();

    sigmaCloudHttpClientInstance.setAuthenticationStrategy(new BearerStrategy.BearerStrategy(process.env.SIGMA_CLOUD_BEARER_TOKEN as string));

    const companyMapList = await sigmaCloudHttpClientInstance.get<ICompanyMap.ICompanyMap[]>('https://api.segware.com.br/v1/companies');
    const startDate = momentTimezone.utc(sigmaCloudDispatchesTrackerWindow.created_at).subtract(3, 'hours');
    const endDate = momentTimezone.utc(sigmaCloudDispatchesTrackerWindow.created_at).subtract(3, 'hours').add(DISPATCHES_PERIOD_MILLISECONDS, 'milliseconds');
    const startDateToDate = startDate.toDate();
    const startDateFormattation = startDate.clone().format('YYYY-MM-DD HH:mm:ss');
    const endDateToDate = endDate.toDate();
    const endDateFormattation = endDate.clone().format('YYYY-MM-DD HH:mm:ss');
    const whatsAppHttpClientInstance = new HttpClientUtil.HttpClient();

    Promise.allSettled(
      companyMapList.data.map(
        async (companyMap: ICompanyMap.ICompanyMap): Promise<void> => {
          const dispatchMapList = await sigmaCloudHttpClientInstance.get<IDispatchMap.IDispatchMap[]>(`https://api.segware.com.br/v1/dispatches?companyId=${ companyMap.id }&startDate=${ startDate }&endDate=${ endDate }`);
          
          await Promise.allSettled(
            dispatchMapList.data.map(
              async (dispatchMap: IDispatchMap.IDispatchMap): Promise<void> => {
                const dispatchMapAccountId = dispatchMap.account.id;
                const sigmaCloudDispatchesTrackerTrigger = await prisma.sigma_cloud_dispatches_tracker_triggers.findUnique({ where: { account_id: dispatchMapAccountId } });

                let count = 0;
        
                Object
                  .values(dispatchMap.dispatches)
                  .forEach(
                    (dispatchCount: number): void => {
                      count += dispatchCount;
                    }
                  );
        
                if (count >= DISPATCHES_COUNT_THRESHOLD) {
                  if (sigmaCloudDispatchesTrackerTrigger) {
                    if (sigmaCloudDispatchesTrackerTrigger.quantity >= count) {
                      return;
                    }

                    await prisma.sigma_cloud_dispatches_tracker_triggers.update(
                      {
                        where: { account_id: dispatchMapAccountId },
                        data: { quantity: count },
                      }
                    );
                  } else {
                    await prisma.sigma_cloud_dispatches_tracker_triggers.create(
                      {
                        data: { 
                          account_id: dispatchMapAccountId, 
                          quantity: count 
                        }
                      }
                    );
                  }

                  const accountMap = (await sigmaCloudHttpClientInstance.get<IAccountMap.IAccountMap>(`https://api.segware.com.br/v5/accounts/${ dispatchMapAccountId }`)).data;
                  const accountMapCompanyId = accountMap.companyId;
                  const accountMapClientGroupId = accountMap.clientGroupId;
                  const accountMapAccountCode = accountMap.accountCode;
                  const accountMapTradeName = accountMap.tradeName;
                  const companyMap = (await sigmaCloudHttpClientInstance.get<ICompanyMap.ICompanyMap>(`https://api.segware.com.br/v1/company/${ accountMapCompanyId }`)).data;
                  const companyMapTradeName = companyMap.tradeName;
                  const clientGroupMapList = (await sigmaCloudHttpClientInstance.get<IClientGroupMap.IClientGroupMap[]>(`https://api.segware.com.br/v1/clientGroups`)).data;
                  const clientGroupMap = clientGroupMapList.find((clientGroupMap: IClientGroupMap.IClientGroupMap): boolean => clientGroupMap.id === accountMapClientGroupId);
                  const clientGroupMapName = clientGroupMap?.name || 'Vazio';

                  await prisma.sigma_cloud_dispatches_tracker_registers.create(
                    {
                      data: {
                        account_code: accountMapAccountCode,
                        trade_name: accountMapTradeName,
                        company_trade_name: companyMapTradeName,
                        client_group_name: clientGroupMapName,
                        quantity: count,
                        period_started_at: startDateToDate,
                        period_ended_at: endDateToDate
                      }
                    }
                  );

                  try {
                    await whatsAppHttpClientInstance.post<unknown>(
                      `https://v5.chatpro.com.br/${ process.env.CHAT_PRO_INSTANCE_ID }/api/v1/send_message`,
                      {
                        number: process.env.CHAT_PRO_GROUP_JID as string,
                        message: `⚠️ *EXCESSO DE PERCURSOS* ⚠️\n\n*Conta:* ${ accountMapAccountCode }\n*Nome:* ${ accountMapTradeName.length >= ACCOUNT_TRADE_NAME_LENGTH ? accountMapTradeName.slice(0, ACCOUNT_TRADE_NAME_LENGTH).trimEnd() + '...' : accountMapTradeName }\n*Empresa:* ${ companyMapTradeName }\n*Grupo:* ${ clientGroupMapName }\n*Quantidade:* ${ count }\n*Período Inicial:* ${ startDateFormattation }\n*Período Final:* ${ endDateFormattation }`
                      },
                      {
                        headers: { Authorization: process.env.CHAT_PRO_BEARER_TOKEN },
                        params: { instance_id: process.env.CHAT_PRO_INSTANCE_ID }
                      }
                    );
                  } catch (error: unknown) {
                    loggerUtil.error(error instanceof Error ? error.message : String(error));
                  }

                  try {
                    await sigmaCloudHttpClientInstance.post<unknown>(
                      'https://api.segware.com.br/v3/events/alarm', 
                      { 
                        events: [
                          {
                            account: accountMapAccountCode,
                            auxiliary: AUXILIARY,
                            code: EVENT_CODE,
                            companyId: accountMapCompanyId,
                            complement: `Advertência: Excesso de deslocamentos detectado, Quantidade: ${ count }, Período Inicial: ${ startDateFormattation }, Período Final: ${ endDateFormattation }`,
                            eventId: EVENT_ID,
                            eventLog: `Advertência: Excesso de deslocamentos detectado, Quantidade: ${ count }, Período Inicial: ${ startDateFormattation }, Período Final: ${ endDateFormattation }`,
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
                          account: accountMapAccountCode,
                          auxiliary: AUXILIARY,
                          code: EVENT_CODE,
                          company_id: accountMapCompanyId,
                          complement: `Advertência: Excesso de deslocamentos detectado, Quantidade: ${ count }, Período Inicial: ${ startDateFormattation }, Período Final: ${ endDateFormattation }`,
                          event_id: EVENT_ID,
                          event_log: `Advertência: Excesso de deslocamentos detectado, Quantidade: ${ count }, Período Inicial: ${ startDateFormattation }, Período Final: ${ endDateFormattation }`,
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
                          account: accountMapAccountCode,
                          auxiliary: AUXILIARY,
                          code: EVENT_CODE,
                          company_id: accountMapCompanyId,
                          complement: `Advertência: Excesso de deslocamentos detectado, Quantidade: ${ count }, Período Inicial: ${ startDateFormattation }, Período Final: ${ endDateFormattation }`,
                          event_id: EVENT_ID,
                          event_log: `Advertência: Excesso de deslocamentos detectado, Quantidade: ${ count }, Período Inicial: ${ startDateFormattation }, Período Final: ${ endDateFormattation }`,
                          partition: PARTITION,
                          protocol_type: PROTOCOL_TYPE,
                          status: 'failed'
                        }
                      }
                    );
                  }
                } else if (sigmaCloudDispatchesTrackerTrigger && count < DISPATCHES_COUNT_THRESHOLD) {
                  await prisma.sigma_cloud_dispatches_tracker_triggers.delete({ where: { account_id: dispatchMapAccountId } });
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
