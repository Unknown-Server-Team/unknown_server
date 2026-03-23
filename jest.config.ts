import type { Config } from 'jest';

const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.test.ts'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: {
                module: 'commonjs',
                strict: false,
                noUnusedLocals: false,
                noUnusedParameters: false,
                noImplicitReturns: false,
                types: ['node', 'jest']
            }
        }]
    },
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1'
    },
    collectCoverageFrom: [
        'managers/AIFunctions.ts',
        'managers/AiManager.ts',
        'managers/NVIDIAModelsManager.ts',
        'managers/VersionManager.ts',
        'managers/utils/DocGenerator.ts',
        'routers/api/v1/ai.ts'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov']
};

export default config;
