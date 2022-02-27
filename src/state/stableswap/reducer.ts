import { createReducer } from '@reduxjs/toolkit'
// import { StableSwapData } from '../../hooks/useCalculateStableSwapPairs'
import { Field, replaceStableSwapState, selectCurrency, setRecipient, switchCurrencies, typeInput } from './actions'
// import { STABLE_SWAP_TYPES } from './constants'

export interface StableSwapState {
  readonly independentField: Field
  readonly typedValue: string
  readonly [Field.INPUT]: {
    readonly currencyId: string | undefined
  }
  readonly [Field.OUTPUT]: {
    readonly currencyId: string | undefined
  }
  // the typed recipient address or ENS name, or null if swap should go to sender
  readonly recipient: string | null
}

// @nocommit stableswap form state
// type FormState = {
//   error: null | string
//   from: {
//     value: string
//     valueUSD: BigNumber
//     symbol: string
//     poolName?: string
//     tokenIndex?: number
//   }
//   to: {
//     value: BigNumber
//     valueUSD: BigNumber
//     valueSynth: BigNumber
//     symbol: string
//     poolName?: string
//     tokenIndex?: number
//   }
//   priceImpact: BigNumber
//   exchangeRate: BigNumber
//   route: string[]
//   swapType: STABLE_SWAP_TYPES
//   currentSwapPairs: StableSwapData[]
// }

const initialState: StableSwapState = {
  independentField: Field.INPUT,
  typedValue: '',
  [Field.INPUT]: {
    currencyId: ''
  },
  [Field.OUTPUT]: {
    currencyId: ''
  },
  recipient: null
}

export default createReducer<StableSwapState>(initialState, builder =>
  builder
    .addCase(
      replaceStableSwapState,
      (state, { payload: { typedValue, recipient, field, inputCurrencyId, outputCurrencyId } }) => {
        return {
          [Field.INPUT]: {
            currencyId: inputCurrencyId
          },
          [Field.OUTPUT]: {
            currencyId: outputCurrencyId
          },
          independentField: field,
          typedValue: typedValue,
          recipient
        }
      }
    )
    .addCase(selectCurrency, (state, { payload: { currencyId, field } }) => {
      const otherField = field === Field.INPUT ? Field.OUTPUT : Field.INPUT
      if (currencyId === state[otherField].currencyId) {
        // the case where we have to swap the order
        return {
          ...state,
          independentField: state.independentField === Field.INPUT ? Field.OUTPUT : Field.INPUT,
          [field]: { currencyId: currencyId },
          [otherField]: { currencyId: state[field].currencyId }
        }
      } else {
        // the normal case
        return {
          ...state,
          [field]: { currencyId: currencyId }
        }
      }
    })
    .addCase(switchCurrencies, state => {
      return {
        ...state,
        independentField: state.independentField === Field.INPUT ? Field.OUTPUT : Field.INPUT,
        [Field.INPUT]: { currencyId: state[Field.OUTPUT].currencyId },
        [Field.OUTPUT]: { currencyId: state[Field.INPUT].currencyId }
      }
    })
    .addCase(typeInput, (state, { payload: { field, typedValue } }) => {
      return {
        ...state,
        independentField: field,
        typedValue
      }
    })
    .addCase(setRecipient, (state, { payload: { recipient } }) => {
      state.recipient = recipient
    })
)
