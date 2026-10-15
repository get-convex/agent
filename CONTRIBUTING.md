# Developing guide

## Running locally

```sh
npm i
npm run dev
```

## Testing

```sh
npm run build:clean
npm run typecheck
npm run lint
npm run test
```

## Deploying

### Building a one-off package

```sh
npm ci
npm run build:clean
npm pack
```

### Deploying a new version

```sh
npm run release
```

or for alpha release:

```sh
npm run alpha
```
