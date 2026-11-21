#!/usr/bin/env node

import { createCLI } from '../src/cli/argument-parser.js';

const program = createCLI();
program.parse(process.argv);
