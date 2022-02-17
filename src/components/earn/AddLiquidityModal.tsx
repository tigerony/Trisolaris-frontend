import React, { useCallback, useContext, useState } from 'react'
import Modal from '../Modal'
import { AutoColumn, ColumnCenter } from '../Column'
import styled, { ThemeContext } from 'styled-components'
import Row, { RowBetween } from '../Row'
import { TYPE, CloseIcon } from '../../theme'
import { ButtonError, ButtonLight, ButtonPrimary } from '../Button'
import { TransactionResponse } from '@ethersproject/providers'
import { useTransactionAdder } from '../../state/transactions/hooks'
import { useActiveWeb3React } from '../../hooks'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '../../hooks/Tokens'
import useTransactionDeadline from '../../hooks/useTransactionDeadline'
import { useIsExpertMode, useUserSlippageTolerance } from '../../state/user/hooks'
import { Field } from '../../state/mint/actions'
import { CETH, ChainId, Currency, ROUTER_ADDRESS } from '@trisolaris/sdk'
import { ApprovalState, useApproveCallback } from '../../hooks/useApproveCallback'
import {
  calculateGasMargin,
  calculateSlippageAmount,
  divideCurrencyAmountByNumber,
  getRouterContract
} from '../../utils'
import { BigNumber } from '@ethersproject/bignumber'
import ReactGA from 'react-ga'
import { wrappedCurrency } from '../../utils/wrappedCurrency'
import TransactionConfirmationModal, { ConfirmationModalContent } from '../TransactionConfirmationModal'
import { BlueCard, LightCard } from '../Card'
import { Text } from 'rebass'
import { Plus } from 'react-feather'
import CurrencyInputPanel from '../CurrencyInputPanel'
import { Dots } from '../swap/styleds'
import { useWalletModalToggle } from '../../state/application/hooks'
import DoubleCurrencyLogo from '../DoubleLogo'
import { useDerivedMintInfo, useMintActionHandlers, useMintState } from '../../state/mint/hooks'
import { ConfirmAddModalBottom } from '../../pages/AddLiquidity/ConfirmAddModalBottom'
import { currencyId } from '../../utils/currencyId'
import { PairState } from '../../data/Reserves'
import PriceAndPoolShare from '../../pages/AddLiquidity/PriceAndPoolShare'
import BalanceButtonValueEnum from '../BalanceButton/BalanceButtonValueEnum'
import useCurrencyInputPanel from '../CurrencyInputPanel/useCurrencyInputPanel'

const ContentWrapper = styled(AutoColumn)`
  width: 100%;
  padding: 1rem;
`

interface AddLiquidityModalProps {
  isOpen: boolean
  onDismiss: () => void
  currencyIdA: string
  currencyIdB: string
}

export default function AddLiquidityModal({
  isOpen,
  onDismiss,
  currencyIdA: _currencyIdA,
  currencyIdB: _currencyIdB
}: AddLiquidityModalProps) {
  const { account, chainId, library } = useActiveWeb3React()
  const theme = useContext(ThemeContext)
  const { t } = useTranslation()

  const [currencyIdA, setCurrencyIdA] = useState(_currencyIdA)
  const [currencyIdB, setCurrencyIdB] = useState(_currencyIdB)

  const currencyA = useCurrency(currencyIdA)
  const currencyB = useCurrency(currencyIdB)

  const toggleWalletModal = useWalletModalToggle() // toggle wallet when disconnected

  const expertMode = useIsExpertMode()

  // mint state
  const { independentField, typedValue, otherTypedValue } = useMintState()
  const {
    dependentField,
    currencies,
    pairState,
    currencyBalances,
    parsedAmounts,
    price,
    noLiquidity,
    liquidityMinted,
    poolTokenPercentage,
    error
  } = useDerivedMintInfo(currencyA ?? undefined, currencyB ?? undefined)
  const { onFieldAInput, onFieldBInput } = useMintActionHandlers(noLiquidity)

  const isValid = !error

  // modal and loading
  const [showConfirm, setShowConfirm] = useState<boolean>(false)
  const [attemptingTxn, setAttemptingTxn] = useState<boolean>(false) // clicked confirm

  // txn values
  const deadline = useTransactionDeadline() // custom from users settings
  const [allowedSlippage] = useUserSlippageTolerance() // custom from users
  const [txHash, setTxHash] = useState<string>('')

  // get formatted amounts
  const formattedAmounts = {
    [independentField]: typedValue,
    [dependentField]: noLiquidity ? otherTypedValue : parsedAmounts[dependentField]?.toSignificant(6) ?? ''
  }

  const { getMaxAmounts } = useCurrencyInputPanel()
  const { maxAmounts, atMaxAmounts, atHalfAmounts } = getMaxAmounts({ currencyBalances, parsedAmounts })

  // check whether the user has approved the router on the tokens
  const [approvalA, approveACallback] = useApproveCallback(
    parsedAmounts[Field.CURRENCY_A],
    chainId ? ROUTER_ADDRESS[chainId] : ROUTER_ADDRESS[ChainId.AVALANCHE]
  )
  const [approvalB, approveBCallback] = useApproveCallback(
    parsedAmounts[Field.CURRENCY_B],
    chainId ? ROUTER_ADDRESS[chainId] : ROUTER_ADDRESS[ChainId.AVALANCHE]
  )

  const addTransaction = useTransactionAdder()

  async function onAdd() {
    if (!chainId || !library || !account) return
    const router = getRouterContract(chainId, library, account)

    const { [Field.CURRENCY_A]: parsedAmountA, [Field.CURRENCY_B]: parsedAmountB } = parsedAmounts
    if (!parsedAmountA || !parsedAmountB || !currencyA || !currencyB || !deadline) {
      return
    }

    const amountsMin = {
      [Field.CURRENCY_A]: calculateSlippageAmount(parsedAmountA, noLiquidity ? 0 : allowedSlippage)[0],
      [Field.CURRENCY_B]: calculateSlippageAmount(parsedAmountB, noLiquidity ? 0 : allowedSlippage)[0]
    }

    let estimate,
      method: (...args: any) => Promise<TransactionResponse>,
      args: Array<string | string[] | number>,
      value: BigNumber | null
    if (currencyA === CETH || currencyB === CETH) {
      const tokenBIsETH = currencyB === CETH
      estimate = router.estimateGas.addLiquidityETH
      method = router.addLiquidityETH
      args = [
        wrappedCurrency(tokenBIsETH ? currencyA : currencyB, chainId)?.address ?? '', // token
        (tokenBIsETH ? parsedAmountA : parsedAmountB).raw.toString(), // token desired
        amountsMin[tokenBIsETH ? Field.CURRENCY_A : Field.CURRENCY_B].toString(), // token min
        amountsMin[tokenBIsETH ? Field.CURRENCY_B : Field.CURRENCY_A].toString(), // eth min
        account,
        deadline.toHexString()
      ]
      value = BigNumber.from((tokenBIsETH ? parsedAmountB : parsedAmountA).raw.toString())
    } else {
      estimate = router.estimateGas.addLiquidity
      method = router.addLiquidity
      args = [
        wrappedCurrency(currencyA, chainId)?.address ?? '',
        wrappedCurrency(currencyB, chainId)?.address ?? '',
        parsedAmountA.raw.toString(),
        parsedAmountB.raw.toString(),
        amountsMin[Field.CURRENCY_A].toString(),
        amountsMin[Field.CURRENCY_B].toString(),
        account,
        deadline.toHexString()
      ]
      value = null
    }

    setAttemptingTxn(true)
    await estimate(...args, value ? { value } : {})
      .then(estimatedGasLimit =>
        method(...args, {
          ...(value ? { value } : {}),
          gasLimit: calculateGasMargin(estimatedGasLimit)
        }).then(response => {
          setAttemptingTxn(false)

          addTransaction(response, {
            summary:
              'Add ' +
              parsedAmounts[Field.CURRENCY_A]?.toSignificant(3) +
              ' ' +
              currencies[Field.CURRENCY_A]?.symbol +
              ' and ' +
              parsedAmounts[Field.CURRENCY_B]?.toSignificant(3) +
              ' ' +
              currencies[Field.CURRENCY_B]?.symbol
          })

          setTxHash(response.hash)

          ReactGA.event({
            category: 'Liquidity',
            action: 'Add',
            label: [currencies[Field.CURRENCY_A]?.symbol, currencies[Field.CURRENCY_B]?.symbol].join('/')
          })
        })
      )
      .catch(error => {
        setAttemptingTxn(false)
        // we only care if the error is something _other_ than the user rejected the tx
        if (error?.code !== 4001) {
          console.error(error)
        }
      })
  }

  const modalHeader = () => {
    return (
      <>
        <RowBetween style={{ marginTop: '20px' }}>
          <Text fontSize="48px" fontWeight={500} lineHeight="42px" marginRight={10}>
            {liquidityMinted?.toSignificant(6)}
          </Text>
          <DoubleCurrencyLogo
            currency0={currencies[Field.CURRENCY_A]}
            currency1={currencies[Field.CURRENCY_B]}
            size={30}
          />
        </RowBetween>
        <Row>
          <Text fontSize="24px">
            {currencies[Field.CURRENCY_A]?.symbol +
              '/' +
              currencies[Field.CURRENCY_B]?.symbol +
              t('addLiquidity.poolTokens')}
          </Text>
        </Row>
        <TYPE.italic fontSize={12} textAlign="left" padding={'8px 0 0 0 '}>
          {t('addLiquidity.outputEstimated', { allowedSlippage: allowedSlippage / 100 })}
        </TYPE.italic>
      </>
    )
  }

  const modalBottom = () => {
    return (
      <ConfirmAddModalBottom
        price={price}
        currencies={currencies}
        parsedAmounts={parsedAmounts}
        noLiquidity={noLiquidity}
        onAdd={onAdd}
        poolTokenPercentage={poolTokenPercentage}
      />
    )
  }

  const pendingText = `Supplying ${parsedAmounts[Field.CURRENCY_A]?.toSignificant(6)} ${
    currencies[Field.CURRENCY_A]?.symbol
  } and ${parsedAmounts[Field.CURRENCY_B]?.toSignificant(6)} ${currencies[Field.CURRENCY_B]?.symbol}`

  const handleCurrencyASelect = useCallback(
    (currencyA: Currency) => {
      const newCurrencyIdA = currencyId(currencyA)
      if (newCurrencyIdA === currencyIdB) {
        setCurrencyIdA(currencyIdB)
        setCurrencyIdB(currencyIdA)
      } else {
        setCurrencyIdA(newCurrencyIdA)
      }
    },
    [currencyIdB, currencyIdA]
  )
  const handleCurrencyBSelect = useCallback(
    (currencyB: Currency) => {
      const newCurrencyIdB = currencyId(currencyB)
      if (newCurrencyIdB === currencyIdA) {
        setCurrencyIdA(currencyIdB)
        setCurrencyIdB(currencyIdA)
      } else {
        setCurrencyIdB(newCurrencyIdB)
      }
    },
    [currencyIdA, currencyIdB]
  )

  const handleDismissConfirmation = useCallback(() => {
    setShowConfirm(false)
    // if there was a tx hash, we want to clear the input
    if (txHash) {
      onFieldAInput('')
    }
    setTxHash('')
  }, [onFieldAInput, txHash])

  function wrappedOnDismiss() {
    // setHash(undefined)
    // setAttempting(false)
    onDismiss()
  }

  return (
    <Modal isOpen={isOpen} onDismiss={wrappedOnDismiss} maxHeight={250}>
      <TransactionConfirmationModal
        isOpen={showConfirm}
        onDismiss={handleDismissConfirmation}
        attemptingTxn={attemptingTxn}
        hash={txHash}
        content={() => (
          <ConfirmationModalContent
            title={noLiquidity ? t('addLiquidity.creatingPool') : t('addLiquidity.willReceive')}
            onDismiss={handleDismissConfirmation}
            topContent={modalHeader}
            bottomContent={modalBottom}
          />
        )}
        pendingText={pendingText}
      />
      <ContentWrapper gap="lg">
        <RowBetween>
          <TYPE.mediumHeader>{t('navigationTabs.addLiquidity')}</TYPE.mediumHeader>
          <CloseIcon onClick={wrappedOnDismiss} />
        </RowBetween>

        <AutoColumn gap="20px">
          {noLiquidity && (
            <ColumnCenter>
              <BlueCard>
                <AutoColumn gap="10px">
                  <TYPE.link fontWeight={600} color={'primaryText1'}>
                    {t('addLiquidity.firstLP')}
                  </TYPE.link>
                  <TYPE.link fontWeight={400} color={'primaryText1'}>
                    {t('addLiquidity.ratioTokens')}
                  </TYPE.link>
                  <TYPE.link fontWeight={400} color={'primaryText1'}>
                    {t('addLiquidity.happyRate')}
                  </TYPE.link>
                </AutoColumn>
              </BlueCard>
            </ColumnCenter>
          )}
          <CurrencyInputPanel
            value={formattedAmounts[Field.CURRENCY_A]}
            onUserInput={onFieldAInput}
            onClickBalanceButton={value => {
              const amount = maxAmounts[Field.CURRENCY_A]
              onFieldAInput(
                (value === BalanceButtonValueEnum.MAX ? amount : divideCurrencyAmountByNumber(amount, 2))?.toExact() ??
                  ''
              )
            }}
            disableHalfButton={atHalfAmounts[Field.CURRENCY_A]}
            disableMaxButton={atMaxAmounts[Field.CURRENCY_A]}
            onCurrencySelect={handleCurrencyASelect}
            currency={currencies[Field.CURRENCY_A]}
            id="add-liquidity-input-tokena"
            showCommonBases
          />
          <ColumnCenter>
            <Plus size="16" color={theme.text2} />
          </ColumnCenter>
          <CurrencyInputPanel
            value={formattedAmounts[Field.CURRENCY_B]}
            onUserInput={onFieldBInput}
            onCurrencySelect={handleCurrencyBSelect}
            onClickBalanceButton={value => {
              const amount = maxAmounts[Field.CURRENCY_B]
              onFieldBInput(
                (value === BalanceButtonValueEnum.MAX ? amount : divideCurrencyAmountByNumber(amount, 2))?.toExact() ??
                  ''
              )
            }}
            disableHalfButton={atHalfAmounts[Field.CURRENCY_B]}
            disableMaxButton={atMaxAmounts[Field.CURRENCY_B]}
            currency={currencies[Field.CURRENCY_B]}
            id="add-liquidity-input-tokenb"
            showCommonBases
          />
          {currencies[Field.CURRENCY_A] && currencies[Field.CURRENCY_B] && pairState !== PairState.INVALID && (
            <PriceAndPoolShare
              currencies={currencies}
              noLiquidity={noLiquidity}
              poolTokenPercentage={poolTokenPercentage}
              price={price}
            />
          )}

          {!account ? (
            <ButtonLight onClick={toggleWalletModal}>{t('addLiquidity.connectWallet')}</ButtonLight>
          ) : (
            <AutoColumn gap={'md'}>
              {(approvalA === ApprovalState.NOT_APPROVED ||
                approvalA === ApprovalState.PENDING ||
                approvalB === ApprovalState.NOT_APPROVED ||
                approvalB === ApprovalState.PENDING) &&
                isValid && (
                  <RowBetween>
                    {approvalA !== ApprovalState.APPROVED && (
                      <ButtonPrimary
                        onClick={approveACallback}
                        disabled={approvalA === ApprovalState.PENDING}
                        width={approvalB !== ApprovalState.APPROVED ? '48%' : '100%'}
                      >
                        {approvalA === ApprovalState.PENDING ? (
                          <Dots>Approving {currencies[Field.CURRENCY_A]?.symbol}</Dots>
                        ) : (
                          t('addLiquidity.approve') + currencies[Field.CURRENCY_A]?.symbol
                        )}
                      </ButtonPrimary>
                    )}
                    {approvalB !== ApprovalState.APPROVED && (
                      <ButtonPrimary
                        onClick={approveBCallback}
                        disabled={approvalB === ApprovalState.PENDING}
                        width={approvalA !== ApprovalState.APPROVED ? '48%' : '100%'}
                      >
                        {approvalB === ApprovalState.PENDING ? (
                          <Dots>Approving {currencies[Field.CURRENCY_B]?.symbol}</Dots>
                        ) : (
                          t('addLiquidity.approve') + currencies[Field.CURRENCY_B]?.symbol
                        )}
                      </ButtonPrimary>
                    )}
                  </RowBetween>
                )}
              <ButtonError
                onClick={() => {
                  expertMode ? onAdd() : setShowConfirm(true)
                }}
                disabled={!isValid || approvalA !== ApprovalState.APPROVED || approvalB !== ApprovalState.APPROVED}
                error={!isValid && !!parsedAmounts[Field.CURRENCY_A] && !!parsedAmounts[Field.CURRENCY_B]}
              >
                <Text fontSize={20} fontWeight={500}>
                  {error ?? t('addLiquidity.supply')}
                </Text>
              </ButtonError>
            </AutoColumn>
          )}
        </AutoColumn>
      </ContentWrapper>
    </Modal>
  )
}
