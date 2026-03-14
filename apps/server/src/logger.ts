import { Logger } from "@openkit/logger";

export const log = new Logger("server");

export { Logger, type LogEntry, type LogSink, type LogLevel } from "@openkit/logger";
