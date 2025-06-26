import { Static, Type, TSchema } from '@sinclair/typebox';
import type { Event } from '@tak-ps/etl';
import ETL, { SchemaType, handler as internal, local, InputFeature, InputFeatureCollection, DataFlowType, InvocationType } from '@tak-ps/etl';

import { fetch } from '@tak-ps/etl';

const InputSchema = Type.Object({
    AgencyName: Type.String({
        description: 'Account Name used to login to evidence.com'
    }),
    AgencyAcronym: Type.Optional(Type.String({
        description: 'Used to prefix the Callsign'
    })),
    DataTimeout: Type.Integer({
        description: 'Get locations updated within the last provided number of minutes',
        default: 5
    }),
    PartnerID: Type.String({
        description: 'Generated as part of API Access Flow'
    }),
    ClientID: Type.String({
        description: 'Generated as part of API Access Flow'
    }),
    ClientSecret: Type.String({
        description: 'Generated as part of API Access Flow'
    }),
    DEBUG: Type.Boolean({
        default: false,
        description: 'Print results in logs'
    })
});

const OutputSchema = Type.Object({
    partnerName: Type.String(),
    axonDeviceId: Type.String(),
    deviceModel: Type.String(),
    deviceUpdateTimestamp: Type.Integer(),
    deviceSerial: Type.String(),
    location_accuracy: Type.Number(),
    location_latitude: Type.Number(),
    location_longitude: Type.Number(),
    location_locationUpdateTimestamp: Type.Integer(),
    status: Type.String(),
    stream_isStreamable: Type.Boolean(),
    signalStrength: Type.Optional(Type.String()),
    battery: Type.Optional(Type.Integer()),
    primary_assignee_firstName: Type.Optional(Type.String()),
    primary_assignee_lastName: Type.Optional(Type.String()),
    primary_assignee_badgeNumber: Type.Optional(Type.String()),
    primary_assignee_userId: Type.Optional(Type.String())
});

export default class Task extends ETL {
    static name = 'etl-axon'
    static flow = [ DataFlowType.Incoming ];
    static invocation = [ InvocationType.Schedule ];

    async schema(
        type: SchemaType = SchemaType.Input,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<TSchema> {
        if (flow === DataFlowType.Incoming) {
            if (type === SchemaType.Input) {
                return InputSchema;
            } else {
                return OutputSchema;
            }
        } else {
            return Type.Object({});
        }
    }

    async control(): Promise<void> {
        const layer = await this.fetchLayer();
        const env = await this.env(InputSchema);

        let access_token;

        if (
            !layer.incoming.ephemeral.access_token
            || !layer.incoming.ephemeral.access_token_expires
            // If Token is going to expire within 1 minute, request a new token
            || (Number(layer.incoming.ephemeral.access_token_expires) + 60000) < +new Date()
        ) {
            console.log('ok - Requesting New Token');

            const oauthReq = await fetch(`https://${env.AgencyName}.evidence.com/api/oauth2/token`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    grant_type: 'client_credentials',
                    partner_id: env.PartnerID,
                    client_id: env.ClientID,
                    client_secret: env.ClientSecret
                })
            })

            const oauthRes = await oauthReq.typed(Type.Object({
                access_token: Type.String(),
                token_type: Type.String(),
                expires_in: Type.Integer(),
                expires_on: Type.Integer(),
                not_before: Type.Integer(),
                version: Type.String(),
                entity: Type.Object({
                    type: Type.String(),
                    id: Type.String(),
                    partner_id: Type.String()
                })
            }));

            await this.setEphemeral({
                access_token: oauthRes.access_token,
                access_token_expires: String(oauthRes.expires_on)
            })

            access_token = oauthRes.access_token;
        } else {
            access_token = layer.incoming.ephemeral.access_token;
        }

        console.log('ok - requesting devices');
        let from = 0;
        let total = Infinity;

        do {
            const devicesReq = await fetch(`https://${env.AgencyName}.evidence.com/respond/api/v1/devices/states/search`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'Client-Type': 'EXTERNAL',
                    Authorization: `Bearer ${access_token}`
                },
                body: JSON.stringify({
                    from: 0,
                    size: 2000
                })
            });

            const devicesRes = await devicesReq.typed(Type.Object({
                meta: Type.Object({
                    correlationId: Type.String(),
                    serverTimestamp: Type.Integer(),
                    totalHits: Type.Integer(),
                    count: Type.Integer()
                }),
                data: Type.Array(Type.Object({
                    partnerId: Type.String(),
                    partnerName: Type.String(),
                    axonDeviceId: Type.String(),
                    deviceModel: Type.String(),
                    deviceUpdateTimestamp: Type.Integer(),
                    attributes: Type.Object({
                        deviceSerial: Type.String(),
                        location: Type.Optional(Type.Object({
                            accuracy: Type.Number(),
                            latitude: Type.Number(),
                            longitude: Type.Number(),
                            locationUpdateTimestamp: Type.Integer()
                        })),
                        status: Type.String(),
                        stream: Type.Object({
                            isStreamable: Type.Boolean()
                        }),
                        links: Type.Optional(Type.Object({
                            view: Type.String()
                        })),
                        signalStrengths: Type.Optional(Type.Array(Type.Object({
                            signalStrength: Type.String()
                        }))),
                        batteries: Type.Optional(Type.Array(Type.Object({
                            batteryPercentage: Type.Integer()
                        }))),
                        assignees: Type.Optional(Type.Array(Type.Object({
                            assigneeType: Type.String(),
                            firstName: Type.String(),
                            lastName: Type.String(),
                            badgeNumber: Type.String(),
                            userId: Type.String(),
                            primary: Type.Boolean()
                        })))
                    })
                }))
            }), {
                verbose: true
            });

            const features: Static<typeof InputFeature>[] = [];

            for (const device of devicesRes.data) {

                const primary = (device.attributes.assignees || []).filter((user) => {
                    return user.primary
                })

                if (device.attributes.status === 'DOCKED') {
                    // We don't care about charging devices
                    continue;
                } else if (
                    // If the device has no location, we can't use it
                    !device.attributes.location
                    // We cut off devices if we haveh't seen them for 30 minutes
                    || new Date(device.attributes.location.locationUpdateTimestamp).getTime() < new Date().getTime() - (env.DataTimeout * 60 * 1000)
                ) {
                    continue;
                }

                const feat: Static<typeof InputFeature> = {
                    id: device.axonDeviceId,
                    type: 'Feature',
                    properties: {
                        type: 'a-f-G-U-U-L',
                        how: 'm-g',
                        callsign: (primary.length ? `${env.AgencyAcronym || ''} ${primary[0].firstName.slice(0, 1)}. ${primary[0].lastName}` : 'Unknown User').trim(),
                        time: new Date().toISOString(),
                        start: new Date(device.attributes.location.locationUpdateTimestamp).toISOString(),
                        status: device.attributes.batteries ? {
                            battery: String(device.attributes.batteries[0].batteryPercentage)
                        } : undefined,
                        remarks: [
                            `Agency: ${device.partnerName}`,
                            `Name: ${primary.length ? primary[0].firstName + " " + primary[0].lastName: "Unknown"}`
                        ].join('\n'),
                        metadata: {
                            partnerName: device.partnerName,
                            axonDeviceId: device.axonDeviceId,
                            deviceModel: device.deviceModel,
                            deviceUpdateTimestamp: device.deviceUpdateTimestamp,
                            deviceSerial: device.attributes.deviceSerial,
                            location_accuracy: device.attributes.location.accuracy,
                            location_latitude: device.attributes.location.latitude,
                            location_longitude: device.attributes.location.longitude,
                            location_locationUpdateTimestamp: device.attributes.location.locationUpdateTimestamp,
                            status: device.attributes.status,
                            stream_isStreamable: device.attributes.stream ? device.attributes.stream.isStreamable : false,
                            signalStrength: device.attributes.signalStrengths ? device.attributes.signalStrengths[0].signalStrength : undefined,
                            battery: device.attributes.batteries ? device.attributes.batteries[0].batteryPercentage : undefined,
                            primary_assignee_firstName: primary.length ? primary[0].firstName : undefined,
                            primary_assignee_lastName: primary.length ? primary[0].lastName : undefined,
                            primary_assignee_badgeNumber: primary.length ? primary[0].badgeNumber : undefined,
                            primary_assignee_userId: primary.length ? primary[0].userId : undefined
                        }
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: [ device.attributes.location.longitude, device.attributes.location.latitude ]
                    }
                }

                features.push(feat);
            }

            const fc: Static<typeof InputFeatureCollection> = {
                type: 'FeatureCollection',
                features: features
            }

            await this.submit(fc);

            total = devicesRes.meta.totalHits;
            from = from + 2000;
        } while (total > from)
    }
}

await local(await Task.init(import.meta.url), import.meta.url);
export async function handler(event: Event = {}) {
    return await internal(await Task.init(import.meta.url), event);
}

