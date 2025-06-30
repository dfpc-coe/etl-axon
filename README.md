<h1 align='center'>ETL-AXON</h1>

<p align='center'>Pull in Officer Locations via AXON Body Cams</p>

## Setup

1. Contact the administrator of the Axon Evidence Account to create an API Token for the ETL to use.
2. From the admin account navigate to the "Admin" tab![image](https://github.com/user-attachments/assets/f83d665c-aea6-4077-8b2d-ea04105644f7)

3. Then select "API Settings" under "Security Settings"
4. Click "Create Client" & fill in a name - IE "COTAK"
5. For API permissions select the following:
    - `Device: state.any.read Allowed`
    - `Response: self.locate: Allowed`
    - `Response: self.alert_mark: Allowed`
    - `Response: any.locate: Allowed`
    - `Users: read: Allowed`
6. Create the client & Provide the:
- Secret
- Partner ID
- Client ID
- Agency Domain (IE <your-agency>.evidence.com)

<details><summary>Development Information</summary>

DFPC provided Lambda ETLs are currently all written in [NodeJS](https://nodejs.org/en) through the use of a AWS Lambda optimized
Docker container. Documentation for the Dockerfile can be found in the [AWS Help Center](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)

```sh
npm install
```

Add a .env file in the root directory that gives the ETL script the necessary variables to communicate with a local ETL server.
When the ETL is deployed the `ETL_API` and `ETL_LAYER` variables will be provided by the Lambda Environment

```json
{
    "ETL_API": "http://localhost:5001",
    "ETL_LAYER": "19"
}
```

To run the task, ensure the local [CloudTAK](https://github.com/dfpc-coe/CloudTAK/) server is running and then run with typescript runtime
or build to JS and run natively with node

```
ts-node task.ts
```

```
npm run build
cp .env dist/
node dist/task.js
```

### Deployment

Deployment into the CloudTAK environment for configuration is done via automatic releases to the DFPC AWS environment.

Github actions will build and push docker releases on every version tag which can then be automatically configured via the
CloudTAK API.

Non-DFPC users will need to setup their own docker => ECS build system via something like Github Actions or AWS Codebuild.

</details>
