import { Static, Type, TSchema } from '@sinclair/typebox';
import type { Event } from '@tak-ps/etl';
import ETL, { SchemaType, handler as internal, local, InputFeature, InputFeatureCollection, DataFlowType, InvocationType } from '@tak-ps/etl';

// eslint-disable-next-line @typescript-eslint/no-unused-vars --  Fetch with an additional Response.typed(TypeBox Object) definition
import { fetch } from '@tak-ps/etl';

/**
 * The Input Schema contains the environment object that will be requested via the CloudTAK UI
 * It should be a valid TypeBox object - https://github.com/sinclairzx81/typebox
 */
const InputSchema = Type.Object({
    'DEBUG': Type.Boolean({
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
    static name = 'default'
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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Get the Environment from the Server and ensure it conforms to the schema
        const env = await this.env(InputSchema);

        const features: Static<typeof InputFeature>[] = [];

        // Get things here and convert them to GeoJSON Feature Collections
        // That conform to the node-cot Feature properties spec
        // https://github.com/dfpc-coe/node-CoT/

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

