import { ConverterBuilder } from 'opencc-js/core';
import * as Locale from 'opencc-js/preset/t2cn';
import { createSearchConverter, createTextSearch } from '../../content/passage-search.mts';

// Search equivalence is shared with the frontend; canonical originals stay untouched.
export const passageTextSearch = createTextSearch(createSearchConverter(ConverterBuilder, Locale));
