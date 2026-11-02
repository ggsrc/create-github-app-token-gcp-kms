# Create GitHub App Token

[![test](https://github.com/actions/create-github-app-token/actions/workflows/test.yml/badge.svg)](https://github.com/actions/create-github-app-token/actions/workflows/test.yml)

GitHub Action for creating a GitHub App installation access token.

> [!NOTE]
> This is a fork of [actions/create-github-app-token](https://github.com/actions/create-github-app-token) that can sign the app JWT with a private key held in [Google Cloud KMS](https://cloud.google.com/kms/docs), so workflows never see the key. It is otherwise unchanged; see [Sign with Google Cloud KMS](#sign-with-google-cloud-kms). To pick up upstream changes, rebase `main` onto an upstream release tag.

## Sign with Google Cloud KMS

A private key in a repository secret never expires: anyone who can read the secret, for example from a workflow on any branch, can create installation tokens until the key is deleted from the app. With `kms-key-version`, the key lives in Cloud KMS, which can't export it, and the action asks Cloud KMS to sign each app JWT. What a workflow can reach is the ability to sign, bounded by the Workload Identity Federation provider's attribute condition and the key's IAM policy.

The action authenticates to Google Cloud on its own with the job's GitHub OIDC token, so it doesn't need `google-github-actions/auth`. The Google Cloud credentials stay in the action's memory and are never exported to later steps; the OIDC token, the Google Cloud access token and the JWT are masked in logs.

```yaml
jobs:
  hello-world:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # Required to request the GitHub OIDC token
    steps:
      - uses: ggsrc/create-github-app-token-gcp-kms@<commit-sha>
        id: app-token
        with:
          client-id: ${{ vars.APP_CLIENT_ID }}
          kms-key-version: projects/my-project/locations/global/keyRings/github-apps/cryptoKeys/my-app/cryptoKeyVersions/1
          workload-identity-provider: projects/123456789/locations/global/workloadIdentityPools/github/providers/github
          repositories: my-repo
          permission-contents: read
```

Google Cloud setup:

1. Create an `ASYMMETRIC_SIGN` key with algorithm `RSA_SIGN_PKCS1_2048_SHA256` and import the app's private key into it ([importing a key](https://cloud.google.com/kms/docs/importing-a-key)). Then destroy every other copy of the key.
2. Create a [Workload Identity Federation provider for GitHub Actions](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines) with an attribute condition, at least on `assertion.repository_owner_id`.
3. Grant `roles/cloudkms.signer` on the key to the federated identities, for example `principalSet://iam.googleapis.com/projects/<project-number>/locations/global/workloadIdentityPools/<pool>/attribute.repository_owner_id/<owner-id>`. Alternatively, grant it to a service account that those identities may impersonate, and set `service-account`.

## Usage

In order to use this action, you need to:

1. [Register new GitHub App](https://docs.github.com/apps/creating-github-apps/setting-up-a-github-app/creating-a-github-app).
2. [Store the App's Client ID in your repository variables](https://docs.github.com/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables#defining-configuration-variables-for-multiple-workflows) (example: `APP_CLIENT_ID`).
3. [Store the App's private key in your repository secrets](https://docs.github.com/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets?tool=webui#creating-secrets-for-a-repository) (example: `APP_PRIVATE_KEY`).

> [!IMPORTANT]
> An installation access token expires after 1 hour. Please [see this comment](https://github.com/actions/create-github-app-token/issues/121#issuecomment-2043214796) for alternative approaches if you have long-running processes.

### Create a token for the current repository

```yaml
name: Run tests on staging
on:
  push:
    branches:
      - main

jobs:
  hello-world:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@v3
        id: app-token
        with:
          client-id: ${{ vars.APP_CLIENT_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
      - uses: ./actions/staging-tests
        with:
          token: ${{ steps.app-token.outputs.token }}
```

### Use app token with `actions/checkout`

```yaml
on: [pull_request]

jobs:
  auto-format:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@v3
        id: app-token
        with:
          # required
          client-id: ${{ vars.APP_CLIENT_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
      - uses: actions/checkout@v6
        with:
          token: ${{ steps.app-token.outputs.token }}
          ref: ${{ github.head_ref }}
          # Make sure the value of GITHUB_TOKEN will not be persisted in repo's config
          persist-credentials: false
      - uses: creyD/prettier_action@v6
        with:
          github_token: ${{ steps.app-token.outputs.token }}
```

### Create a Git committer string for an app installation

```yaml
on: [pull_request]

jobs:
  auto-format:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@v3
        id: app-token
        with:
          # required
          client-id: ${{ vars.APP_CLIENT_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
      - name: Get GitHub App User ID
        id: get-user-id
        run: echo "user-id=$(gh api "/users/${{ steps.app-token.outputs.app-slug }}[bot]" --jq .id)" >> "$GITHUB_OUTPUT"
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
      - id: committer
        run: echo "string=${{ steps.app-token.outputs.app-slug }}[bot] <${{ steps.get-user-id.outputs.user-id }}+${{ steps.app-token.outputs.app-slug }}[bot]@users.noreply.github.com>"  >> "$GITHUB_OUTPUT"
      - run: echo "committer string is ${{ steps.committer.outputs.string }}"
```

### Configure Git CLI for an app's bot user

```yaml
on: [pull_request]

jobs:
  auto-format:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@v3
        id: app-token
        with:
          # required
          client-id: ${{ vars.APP_CLIENT_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
          permission-contents: write
      - name: Get GitHub App User ID
        id: get-user-id
        run: echo "user-id=$(gh api "/users/${{ steps.app-token.outputs.app-slug }}[bot]" --jq .id)" >> "$GITHUB_OUTPUT"
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
      - run: |
          git config --global user.name '${{ steps.app-token.outputs.app-slug }}[bot]'
          git config --global user.email '${{ steps.get-user-id.outputs.user-id }}+${{ steps.app-token.outputs.app-slug }}[bot]@users.noreply.github.com'
          gh auth setup-git
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
      # Git commands like commit and push work using the bot user
      - run: |
          git add .
          git commit -m "Auto-generated changes"
          git push
```

> [!TIP]
> The `<BOT USER ID>` is the numeric user ID of the app's bot user, which can be found under `https://api.github.com/users/<app-slug>%5Bbot%5D`.
>
> For example, we can check at `https://api.github.com/users/dependabot[bot]` to see the user ID of Dependabot is 49699333.
>
> Alternatively, you can use the [octokit/request-action](https://github.com/octokit/request-action) to get the ID.

### Create a token for all repositories in the current owner's installation

```yaml
on: [workflow_dispatch]

jobs:
  hello-world:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@v3
        id: app-token
        with:
          client-id: ${{ vars.APP_CLIENT_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}
      - uses: peter-evans/create-or-update-comment@v4
        with:
          token: ${{ steps.app-token.outputs.token }}
          issue-number: ${{ github.event.issue.number }}
          body: "Hello, World!"
```

### Create a token for multiple repositories in the current owner's installation

```yaml
on: [issues]

jobs:
  hello-world:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@v3
        id: app-token
        with:
          client-id: ${{ vars.APP_CLIENT_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}
          repositories: |
            repo1
            repo2
      - uses: peter-evans/create-or-update-comment@v4
        with:
          token: ${{ steps.app-token.outputs.token }}
          issue-number: ${{ github.event.issue.number }}
          body: "Hello, World!"
```

You can include the current repository in the list with `${{ github.repository }}`:

```yaml
repositories: ${{ github.repository }},repo2
```

### Create a token for all repositories in another owner's installation

```yaml
on: [issues]

jobs:
  hello-world:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@v3
        id: app-token
        with:
          client-id: ${{ vars.APP_CLIENT_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
          owner: another-owner
      - uses: peter-evans/create-or-update-comment@v4
        with:
          token: ${{ steps.app-token.outputs.token }}
          issue-number: ${{ github.event.issue.number }}
          body: "Hello, World!"
```

### Create a token for an enterprise installation

```yaml
on: [workflow_dispatch]

jobs:
  hello-world:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@v3
        id: app-token
        with:
          client-id: ${{ vars.APP_CLIENT_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
          enterprise: my-enterprise-slug
      - name: Call enterprise management REST API with gh
        run: |
          gh api /enterprises/my-enterprise-slug/apps/installable_organizations
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
```

### Create a token with specific permissions

> [!NOTE]
> Selected permissions must be granted to the specified app installation. Setting a permission that the installation does not have will result in an error.

```yaml
on: [issues]

jobs:
  hello-world:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@v3
        id: app-token
        with:
          client-id: ${{ vars.APP_CLIENT_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}
          permission-issues: write
      - uses: peter-evans/create-or-update-comment@v4
        with:
          token: ${{ steps.app-token.outputs.token }}
          issue-number: ${{ github.event.issue.number }}
          body: "Hello, World!"
```

### Create tokens for multiple user or organization accounts

You can use a matrix strategy to create tokens for multiple user or organization accounts.

> [!NOTE]
> See [this documentation](https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions#multiline-strings) for information on using multiline strings in workflows.

```yaml
on: [workflow_dispatch]

jobs:
  set-matrix:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.set.outputs.matrix }}
    steps:
      - id: set
        run: echo 'matrix=[{"owner":"owner1"},{"owner":"owner2","repos":["repo1"]}]' >>"$GITHUB_OUTPUT"

  use-matrix:
    name: "@${{ matrix.owners-and-repos.owner }} installation"
    needs: [set-matrix]
    runs-on: ubuntu-latest
    strategy:
      matrix:
        owners-and-repos: ${{ fromJson(needs.set-matrix.outputs.matrix) }}

    steps:
      - uses: actions/create-github-app-token@v3
        id: app-token
        with:
          client-id: ${{ vars.APP_CLIENT_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
          owner: ${{ matrix.owners-and-repos.owner }}
          repositories: ${{ join(matrix.owners-and-repos.repos) }}
      - uses: octokit/request-action@v2.x
        id: get-installation-repositories
        with:
          route: GET /installation/repositories
        env:
          GITHUB_TOKEN: ${{ steps.app-token.outputs.token }}
      - run: echo "$MULTILINE_JSON_STRING"
        env:
          MULTILINE_JSON_STRING: ${{ steps.get-installation-repositories.outputs.data }}
```

### Run the workflow in a github.com repository against an organization in GitHub Enterprise Server

```yaml
on: [push]

jobs:
  create_issue:
    runs-on: self-hosted

    steps:
      - name: Create GitHub App token
        id: create_token
        uses: actions/create-github-app-token@v3
        with:
          client-id: ${{ vars.GHES_APP_CLIENT_ID }}
          private-key: ${{ secrets.GHES_APP_PRIVATE_KEY }}
          owner: ${{ vars.GHES_INSTALLATION_ORG }}
          github-api-url: ${{ vars.GITHUB_API_URL }}

      - name: Create issue
        uses: octokit/request-action@v2.x
        with:
          route: POST /repos/${{ github.repository }}/issues
          title: "New issue from workflow"
          body: "This is a new issue created from a GitHub Action workflow."
        env:
          GITHUB_TOKEN: ${{ steps.create_token.outputs.token }}
```

### Proxy support

This action relies on Node.js native proxy support.

If you set `HTTP_PROXY` or `HTTPS_PROXY`, also set `NODE_USE_ENV_PROXY: "1"` on the action step so Node.js honors those variables. If you need proxy bypass rules, set `NO_PROXY` alongside them.

```yaml
- uses: actions/create-github-app-token@v3
  id: app-token
  env:
    HTTPS_PROXY: http://proxy.example.com:8080
    NO_PROXY: github.example.com
    NODE_USE_ENV_PROXY: "1"
  with:
    client-id: ${{ vars.APP_CLIENT_ID }}
    private-key: ${{ secrets.APP_PRIVATE_KEY }}
```

## Inputs

### `client-id` or `app-id`

**Required:** GitHub App Client ID.

> [!NOTE]
> The legacy `app-id` input is also accepted, but `client-id` is recommended.

### `private-key`

**Optional:** GitHub App private key. Either `private-key` or `kms-key-version` must be set. Escaped newlines (`\\n`) will be automatically replaced with actual newlines.

Some other actions may require the private key to be Base64 encoded. To avoid recreating a new secret, it can be decoded on the fly, but it needs to be managed securely. Here is an example of how this can be achieved:

```yaml
steps:
  - name: Decode the GitHub App Private Key
    id: decode
    run: |
      private_key=$(echo "${{ secrets.APP_PRIVATE_KEY }}" | base64 -d | awk 'BEGIN {ORS="\\n"} {print}' | head -c -2) &> /dev/null
      echo "::add-mask::$private_key"
      echo "private-key=$private_key" >> "$GITHUB_OUTPUT"
  - name: Generate GitHub App Token
    id: app-token
    uses: actions/create-github-app-token@v3
    with:
      client-id: ${{ vars.APP_CLIENT_ID }}
      private-key: ${{ steps.decode.outputs.private-key }}
```

### `kms-key-version`

**Optional:** Cloud KMS key version that holds the GitHub App private key, as `projects/<project>/locations/<location>/keyRings/<key-ring>/cryptoKeys/<key>/cryptoKeyVersions/<version>`. Cannot be used with `private-key`. Requires `workload-identity-provider` and the `id-token: write` permission. See [Sign with Google Cloud KMS](#sign-with-google-cloud-kms).

### `workload-identity-provider`

**Optional:** Workload Identity Federation provider used with `kms-key-version`, as `projects/<project-number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`.

### `service-account`

**Optional:** Service account to impersonate when signing with `kms-key-version`. If unset, the federated identity calls Cloud KMS directly.

### `quota-project`

**Optional:** Google Cloud project to bill the Cloud KMS requests to, sent as the `x-goog-user-project` header.

### `owner`

**Optional:** The owner of the GitHub App installation. If empty, defaults to the current repository owner.

### `repositories`

**Optional:** Comma or newline-separated list of repositories to grant access to.

> [!NOTE]
> If `owner` is set explicitly and `repositories` is empty, access will be scoped to all repositories in the provided repository owner's installation. If `owner` and `repositories` are empty, access will be scoped to only the current repository.
>
> Repository entries may include an owner, for example `owner/repo1`. The owner portion must match the `owner` input, or the current repository owner if `owner` is unset.

### `enterprise`

**Optional:** The slug of the enterprise account to generate a token for an enterprise installation.

> [!NOTE]
> The `enterprise` input is mutually exclusive with `owner` and `repositories`. Use it when the GitHub App is installed on an enterprise account. Enterprise installation tokens can call enterprise APIs, but do not grant organization or repository access.

### `permission-<permission name>`

**Optional:** The permissions to grant to the token. By default, the token inherits all of the installation's permissions. We recommend to explicitly list the permissions that are required for a use case. This follows GitHub's own recommendation to [control permissions of `GITHUB_TOKEN` in workflows](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/controlling-permissions-for-github_token). The documentation also lists all available permissions, just prefix the permission key with `permission-` (e.g., `pull-requests` → `permission-pull-requests`).

The reason we define one `permision-<permission name>` input per permission is to benefit from type intelligence and input validation built into GitHub's action runner.

### `skip-token-revoke`

**Optional:** If true, the token will not be revoked when the current job is complete.

### `github-api-url`

**Optional:** The URL of the GitHub REST API. Defaults to the URL of the GitHub Rest API where the workflow is run from.

## Outputs

### `token`

GitHub App installation access token.

### `installation-id`

GitHub App installation ID.

### `app-slug`

GitHub App slug.

## How it works

The action creates an installation access token using [the `POST /app/installations/{installation_id}/access_tokens` endpoint](https://docs.github.com/rest/apps/apps?apiVersion=2022-11-28#create-an-installation-access-token-for-an-app).

The token target depends on the inputs: `enterprise` creates a token for an enterprise installation, `owner` without `repositories` creates a token for all repositories in the owner's installation, `repositories` scopes the token to those repositories, and no target inputs scopes the token to the current repository.

1. The token inherits all the installation's permissions.
2. The token is set as output `token` which can be used in subsequent steps.
3. Unless the `skip-token-revoke` input is set to true, the token is revoked in the `post` step of the action, which means it cannot be passed to another job.
4. The token is masked, it cannot be logged accidentally.

> [!NOTE]
> Installation permissions can differ from the app's permissions they belong to. Installation permissions are set when an app is installed on an account. When the app adds more permissions after the installation, an account administrator will have to approve the new permissions before they are set on the installation.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md)

## License

[MIT](LICENSE)
