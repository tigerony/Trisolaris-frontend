import { BigNumber } from '@ethersproject/bignumber'
import { Contract } from '@ethersproject/contracts'
import { Fraction, JSBI, Percent, Router, SwapParameters, Trade, TradeType } from '@trisolaris/sdk'
import { useMemo } from 'react'
import { BIPS_BASE, INITIAL_ALLOWED_SLIPPAGE } from '../constants'
import { useTransactionAdder } from '../state/transactions/hooks'
import { calculateGasMargin, getRouterContract, isAddress, shortenAddress } from '../utils'
import isZero from '../utils/isZero'
import { useActiveWeb3React } from './index'
import useTransactionDeadline from './useTransactionDeadline'
import useENS from './useENS'
import { Version } from './useToggledVersion'
import { StableSwapTrade } from '../state/stableswap/hooks'

export enum StableSwapCallbackState {
  INVALID,
  LOADING,
  VALID
}

interface StableSwapCall {
  contract: Contract
  parameters: SwapParameters
}

interface SuccessfulCall {
  call: StableSwapCall
  gasEstimate: BigNumber
}

interface FailedCall {
  call: StableSwapCall
  error: Error
}

type EstimatedStableSwapCall = SuccessfulCall | FailedCall

/**
 * Returns the swap calls that can be used to make the trade
 * @param trade trade to execute
 * @param allowedSlippage user allowed slippage
 * @param recipientAddressOrName
 */
function useStableSwapCallArguments(
  // @nocommit UPDATE THIS TO SUPPORT STABLE SWAPS!
  trade: StableSwapTrade | undefined, // trade to execute, required
  allowedSlippage: number = INITIAL_ALLOWED_SLIPPAGE // in bips
  //   recipientAddressOrName: string | null // the ENS name or address of the recipient of the trade, or null if swap should be returned to sender
): StableSwapCall[] {
  const { account, chainId, library } = useActiveWeb3React()

  //   const { address: recipientAddress } = useENS(recipientAddressOrName)
  //   const recipient = recipientAddressOrName === null ? account : recipientAddress
  let deadline = useTransactionDeadline()

  const currentTime = BigNumber.from(new Date().getTime())
  if (deadline && deadline < currentTime.add(10)) {
    deadline = currentTime.add(10)
  }

  return useMemo(() => {
    const tradeVersion = Version.v2
    if (
      !trade ||
      !trade.stableSwapData ||
      !trade.inputAmount ||
      !trade.outputAmount ||
      !library ||
      !account ||
      !tradeVersion ||
      !chainId ||
      !deadline
    )
      return []

    const contract: Contract | null = getRouterContract(chainId, library, account)
    if (!contract) {
      return []
    }

    // const slippage = new Fraction(JSBI.BigInt(1)).add(JSBI.BigInt(allowedSlippage)).multiply(trade.inputAmount)
    const amountOutLessSlippage = new Fraction(JSBI.BigInt(1))
      .add(JSBI.BigInt(allowedSlippage))
      .invert()
      .multiply(trade.outputAmount)

    const swapMethods: any[] = []

    swapMethods.push(
      'swap',
      trade.stableSwapData.from.tokenIndex,
      trade.stableSwapData.to.tokenIndex,
      trade.inputAmount.toExact(),
      amountOutLessSlippage,
      deadline
    )

    return swapMethods.map((parameters: any) => ({ parameters, contract }))
    //   }, [account, allowedSlippage, chainId, deadline, library, recipient, trade])
  }, [account, allowedSlippage, chainId, deadline, library, trade])
}

// returns a function that will execute a swap, if the parameters are all valid
// and the user has approved the slippage adjusted input amount for the trade
export function useStableSwapCallback(
  trade: StableSwapTrade | undefined, // trade to execute, required
  allowedSlippage: number = INITIAL_ALLOWED_SLIPPAGE // in bips
): { state: StableSwapCallbackState; callback: null | (() => Promise<string>); error: string | null } {
  const { account, chainId, library } = useActiveWeb3React()

  const StableswapCalls = useStableSwapCallArguments(trade, allowedSlippage)

  const addTransaction = useTransactionAdder()

  return useMemo(() => {
    if (!trade || !library || !account || !chainId) {
      return { state: StableSwapCallbackState.INVALID, callback: null, error: 'Missing dependencies' }
    }

    return {
      state: StableSwapCallbackState.VALID,
      callback: async function onSwap(): Promise<string> {
        const estimatedCalls: EstimatedStableSwapCall[] = await Promise.all(
          StableswapCalls.map(call => {
            const {
              parameters: { methodName, args, value },
              contract
            } = call
            const options = !value || isZero(value) ? {} : { value }

            return contract.estimateGas[methodName](...args, options)
              .then(gasEstimate => {
                return {
                  call,
                  gasEstimate
                }
              })
              .catch(gasError => {
                console.debug('Gas estimate failed, trying eth_call to extract error', call)

                return contract.callStatic[methodName](...args, options)
                  .then(result => {
                    console.debug('Unexpected successful call after failed estimate gas', call, gasError, result)
                    return { call, error: new Error('Unexpected issue with estimating the gas. Please try again.') }
                  })
                  .catch(callError => {
                    console.debug('Call threw error', call, callError)
                    let errorMessage: string
                    switch (callError.reason) {
                      case 'PangolinRouter: INSUFFICIENT_OUTPUT_AMOUNT':
                      case 'PangolinRouter: EXCESSIVE_INPUT_AMOUNT':
                        errorMessage =
                          'This transaction will not succeed either due to price movement or fee on transfer. Try increasing your slippage tolerance.'
                        break
                      default:
                        errorMessage = `The transaction cannot succeed due to error: ${callError.reason}. This is probably an issue with one of the tokens you are swapping.`
                    }
                    return { call, error: new Error(errorMessage) }
                  })
              })
          })
        )

        // a successful estimation is a bignumber gas estimate and the next call is also a bignumber gas estimate
        const successfulEstimation = estimatedCalls.find(
          (el, ix, list): el is SuccessfulCall =>
            'gasEstimate' in el && (ix === list.length - 1 || 'gasEstimate' in list[ix + 1])
        )

        if (!successfulEstimation) {
          const errorCalls = estimatedCalls.filter((call): call is FailedCall => 'error' in call)
          if (errorCalls.length > 0) throw errorCalls[errorCalls.length - 1].error
          throw new Error('Unexpected error. Please contact support: none of the calls threw an error')
        }

        const {
          call: {
            contract,
            parameters: { methodName, args, value }
          },
          gasEstimate
        } = successfulEstimation

        return contract[methodName](...args, {
          gasLimit: calculateGasMargin(gasEstimate),
          ...(value && !isZero(value) ? { value, from: account } : { from: account })
        })
          .then((response: any) => {
            const inputSymbol = trade.inputAmount.currency.symbol
            const outputSymbol = trade.outputAmount.currency.symbol
            const inputAmount = trade.inputAmount.toSignificant(3)
            const outputAmount = trade.outputAmount.toSignificant(3)

            addTransaction(response, {
              summary: `StableSwap ${inputAmount} ${inputSymbol} for ${outputAmount} ${outputSymbol}`
            })

            return response.hash
          })
          .catch((error: any) => {
            // if the user rejected the tx, pass this along
            if (error?.code === 4001) {
              throw new Error('Transaction rejected.')
            } else {
              // otherwise, the error was unexpected and we need to convey that
              console.error(`Swap failed`, error, methodName, args, value)
              throw new Error(`Swap failed: ${error.message}`)
            }
          })
      },
      error: null
    }
  }, [trade, library, account, chainId, StableswapCalls, addTransaction])
}
