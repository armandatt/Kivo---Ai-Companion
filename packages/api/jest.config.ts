import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^@repo/db/client$": "<rootDir>/__mocks__/db.ts",
    "^../services/memory.service$": "<rootDir>/__mocks__/memory.service.ts",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: false,
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          esModuleInterop: true,
          strict: true,
        },
      },
    ],
  },
  testMatch: ["**/__tests__/**/*.test.ts"],
};

export default config;
