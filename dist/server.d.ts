import { McpServer } from "@modelcontextprotocol/server";
import { GPTProtoClient } from "./client.js";
import { TaskRegistry } from "./tasks.js";
export declare function createServer(client?: GPTProtoClient, tasks?: TaskRegistry): McpServer;
