import { configure } from '@testing-library/react';
import { LAZY_TIMEOUT } from './asyncTimeouts';

// Testing Library's findBy* and waitFor default to 1000 ms, too short for a lazy chunk on a loaded runner.
configure({ asyncUtilTimeout: LAZY_TIMEOUT });
