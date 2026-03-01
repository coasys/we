import { ApolloClient, InMemoryCache } from "@apollo/client";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { Ad4mClient } from "@coasys/ad4m";
import { invoke } from "@tauri-apps/api/core";
import { createClient } from "graphql-ws";

export async function buildAd4mClient(subscribe = true): Promise<Ad4mClient> {
  const port = await invoke("get_port");
  const server = `ws://localhost:${port}/graphql`;
  let token: string = await invoke("request_credential");
  return buildClient(server, token, subscribe);
}

function buildClient(server: string, token: string, subscribe: boolean): Ad4mClient {
  const wsLink = new GraphQLWsLink(
    createClient({
      url: server,
      connectionParams: () => ({
        headers: { authorization: token },
      }),
    })
  );
  const apolloClient = new ApolloClient({
    link: wsLink,
    cache: new InMemoryCache({ resultCaching: false }),
    defaultOptions: {
      watchQuery: { fetchPolicy: "no-cache" },
      query: { fetchPolicy: "no-cache" },
    },
  });

  return new Ad4mClient(apolloClient, subscribe);
}