import { Static, Type, TSchema } from '@sinclair/typebox';
import type { Event } from '@tak-ps/etl';
import ETL, { SchemaType, handler as internal, local, InputFeature, InputFeatureCollection, DataFlowType, InvocationType } from '@tak-ps/etl';

import { fetch } from '@tak-ps/etl';

const InputSchema = Type.Object({
    AgencyName: Type.String({
        description: 'Account Name used to login to evidence.com'
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

/**
 * The Output Schema contains the known properties that will be returned on the
 * GeoJSON Feature in the .properties.metdata object
 */
const OutputSchema = Type.Object({})

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

        if (!layer) {
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
        }

        const features: Static<typeof InputFeature>[] = [];

        const fc: Static<typeof InputFeatureCollection> = {
            type: 'FeatureCollection',
            features: features
        }

        await this.submit(fc);
    }
}

await local(new Task(import.meta.url), import.meta.url);
export async function handler(event: Event = {}) {
    return await internal(new Task(import.meta.url), event);
}

