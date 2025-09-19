import momentTimezone from 'moment-timezone';
import { PrismaClient } from '@prisma/client/storage/client.js'
import { HttpClientUtil, loggerUtil, BearerStrategy } from '../../expressium/index.js';
import { IAccountMap, IClientGroupMap, ICompanyMap, IDispatchMap } from './interfaces/index.js';

const DISPATCHES_PERIOD_DAYS = 3;
const DISPATCHES_COUNT_THRESHOLD = 4;
const AUXILIARY = '0';
const EVENT_CODE = 'E701';
const EVENT_ID = '167629000';
const PARTITION = '000';
const PROTOCOL_TYPE = 'CONTACT_ID';

const prisma = new PrismaClient();

export const createSigmaCloudEvents = async (): Promise<void> => {
  const sigmaCloudHttpClientInstance = new HttpClientUtil.HttpClient();

  sigmaCloudHttpClientInstance.setAuthenticationStrategy(new BearerStrategy.BearerStrategy(process.env.SIGMA_CLOUD_BEARER_TOKEN as string));
  
  try {
    const databaseNow: [{ date: Date }] = await prisma.$queryRaw`SELECT NOW() AS date;`;
    
    let sigmaCloudDispatchesTrackerWindow = await prisma.sigma_cloud_dispatches_tracker_window.findFirst();

    if (!sigmaCloudDispatchesTrackerWindow || momentTimezone.utc(databaseNow[0].date).isAfter(momentTimezone.utc(sigmaCloudDispatchesTrackerWindow.started_at).add(DISPATCHES_PERIOD_DAYS, 'days')))  {
      await prisma.sigma_cloud_dispatches_tracker_window.deleteMany();
      
      sigmaCloudDispatchesTrackerWindow = await prisma.sigma_cloud_dispatches_tracker_window.create({});
    }

    await prisma.sigma_cloud_dispatches_tracker_triggers.deleteMany({ where: { updated_at: { lt: sigmaCloudDispatchesTrackerWindow.created_at } } });

    const companyMapList = await sigmaCloudHttpClientInstance.get<ICompanyMap.ICompanyMap[]>('https://api.segware.com.br/v1/companies');
    const startDate = momentTimezone.utc(sigmaCloudDispatchesTrackerWindow.created_at);
    const endDate = momentTimezone.utc(sigmaCloudDispatchesTrackerWindow.created_at).add(DISPATCHES_PERIOD_DAYS, 'days');
    const whatsAppHttpClientInstance = new HttpClientUtil.HttpClient();
    const startDateFormattation = startDate.clone().format('YYYY-MM-DD HH:mm:ss');
    const endDateFormattation = endDate.clone().format('YYYY-MM-DD HH:mm:ss');

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

                  try {
                    await whatsAppHttpClientInstance.post<unknown>(
                      `https://v5.chatpro.com.br/${ process.env.CHAT_PRO_INSTANCE_ID }/api/v1/send_message`,
                      { 
                        number: process.env.CHAT_PRO_GROUP_JID as string,
                        message: `⚠️EXCESSO DE DESLOCAMENTOS⚠️\n\nConta: ${ accountMapAccountCode }\nNome: ${ accountMapTradeName }\nEmpresa: ${ companyMapTradeName }\nGrupo: ${ clientGroupMapName }\nPeríodo: ${ startDateFormattation } -> ${ endDateFormattation }\nQuantidade: ${ count }`
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
                            account: accountMap.accountCode,
                            auxiliary: AUXILIARY,
                            code: EVENT_CODE,
                            companyId: accountMap.companyId,
                            complement: `Advertência: Excesso de deslocamentos detectado, Período: ${ startDateFormattation } -> ${ endDateFormattation }, Quantidade: ${ count }`,
                            eventId: EVENT_ID,
                            eventLog: `Advertência: Excesso de deslocamentos detectado, Período: ${ startDateFormattation } -> ${ endDateFormattation }, Quantidade: ${ count }`,
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
                          complement: `Advertência: Excesso de deslocamentos detectado, Período: ${ startDateFormattation } -> ${ endDateFormattation }, Quantidade: ${ count }`,
                          event_id: EVENT_ID,
                          event_log: `Advertência: Excesso de deslocamentos detectado, Período: ${ startDateFormattation } -> ${ endDateFormattation }, Quantidade: ${ count }`,
                          partition: PARTITION,
                          protocol_type: PROTOCOL_TYPE,
                          status: 'sent'
                        }
                      }
                    );

                    await prisma.sigma_cloud_dispatches_tracker_registers.create(
                      {
                        data: {
                          account_code: accountMapAccountCode,
                          trade_name: accountMapTradeName,
                          company_trade_name: companyMapTradeName,
                          client_group_name: clientGroupMapName,
                          period: `${ startDateFormattation } -> ${ endDateFormattation }`,
                          quantity: count
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
                          complement: `Advertência: Excesso de deslocamentos detectado, Período: ${ startDateFormattation } -> ${ endDateFormattation }, Quantidade: ${ count }`,
                          event_id: EVENT_ID,
                          event_log: `Advertência: Excesso de deslocamentos detectado, Período: ${ startDateFormattation } -> ${ endDateFormattation }, Quantidade: ${ count }`,
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
