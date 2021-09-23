import { TokenAmount, WETH, JSBI } from '@pangolindex/sdk'
import React, { useMemo, useState } from 'react'
import { X } from 'react-feather'
import styled from 'styled-components'
import tokenLogo from '../../assets/images/token-logo.png'
import { injected } from '../../connectors'
import { PNG } from '../../constants'
import { useTotalSupply } from '../../data/TotalSupply'
import { useActiveWeb3React } from '../../hooks'
import { STAKING_REWARDS_CURRENT_VERSION, useTotalPngEarned } from '../../state/stake/hooks'
import { useAggregatePngBalance, useTokenBalance } from '../../state/wallet/hooks'
import { StyledInternalLink, TYPE, PngTokenAnimated } from '../../theme'
import { AutoColumn } from '../Column'
import { RowBetween } from '../Row'
import { Break, CardBGImage, CardNoise, CardSection, DataCard } from '../earn/styled'
import { usePair } from '../../data/Reserves'
import { useTranslation } from 'react-i18next'

const ContentWrapper = styled(AutoColumn)`
  width: 100%;
`

const ModalUpper = styled(DataCard)`
  box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.1);
  background: radial-gradient(76.02% 75.41% at 1.84% 0%, #f97316 0%, #e84142 100%);
  padding: 0.5rem;
`

const StyledClose = styled(X)`
  position: absolute;
  right: 16px;
  top: 16px;

  :hover {
    cursor: pointer;
  }
`
const AddPNG = styled.span`
  width: 100%;
  height: 100%;
  font-weight: 500;
  font-size: 32;
  padding: 4px 6px;
  align-items: center;
  text-align: center;
  background-color: ${({ theme }) => theme.bg3};
  background: radial-gradient(174.47% 188.91% at 1.84% 0%, #f97316 0%, #e84142 100%), #edeef2;
  border-radius: 12px;
  white-space: nowrap;
  cursor: pointer;

  :hover {
    opacity: 0.8;
  }
`

/**
 * Content for balance stats modal
 */
export default function PngBalanceContent({ setShowPngBalanceModal }: { setShowPngBalanceModal: any }) {
  const { account, chainId } = useActiveWeb3React()
  const png = chainId ? PNG[chainId] : undefined

  const total = useAggregatePngBalance()
  const pngBalance: TokenAmount | undefined = useTokenBalance(account ?? undefined, png)
  const pngToClaim: TokenAmount | undefined = useTotalPngEarned()

  const totalSupply: TokenAmount | undefined = useTotalSupply(png)

  // Determine PNG price in AVAX
  const wavax = WETH[chainId ? chainId : 43114]
  const [, avaxPngTokenPair] = usePair(wavax, png)
  const oneToken = JSBI.BigInt(1000000000000000000)
  const { t } = useTranslation()
  let pngPrice: number | undefined
  if (avaxPngTokenPair && png) {
    const avaxPngRatio = JSBI.divide(
      JSBI.multiply(oneToken, avaxPngTokenPair.reserveOf(wavax).raw),
      avaxPngTokenPair.reserveOf(png).raw
    )
    pngPrice = JSBI.toNumber(avaxPngRatio) / 1000000000000000000
  }

  const [circulation, setCirculation] = useState(totalSupply)

  useMemo(() => {
    if (png === undefined) return
    fetch(`https://api.pangolin.exchange/png/circulating-supply`)
      .then(res => res.text())
      .then(val => setCirculation(new TokenAmount(png, val)))
  }, [png])

  return (
    <ContentWrapper gap="lg">
      <ModalUpper>
        <CardBGImage />
        <CardNoise />
        <CardSection gap="md">
          <RowBetween>
            <TYPE.white color="white">{t('header.pngBreakDown')}</TYPE.white>
            <StyledClose stroke="white" onClick={() => setShowPngBalanceModal(false)} />
          </RowBetween>
        </CardSection>
        <Break />
        {account && (
          <>
            <CardSection gap="sm">
              <AutoColumn gap="md" justify="center">
                <PngTokenAnimated width="48px" src={tokenLogo} />{' '}
                <TYPE.white fontSize={48} fontWeight={600} color="white">
                  {total?.toFixed(2, { groupSeparator: ',' })}
                </TYPE.white>
              </AutoColumn>
              <AutoColumn gap="md">
                <RowBetween>
                  <TYPE.white color="white">{t('header.balance')}</TYPE.white>
                  <TYPE.white color="white">{pngBalance?.toFixed(2, { groupSeparator: ',' })}</TYPE.white>
                </RowBetween>
                <RowBetween>
                  <TYPE.white color="white">{t('header.unclaimed')}</TYPE.white>
                  <TYPE.white color="white">
                    {pngToClaim?.toFixed(4, { groupSeparator: ',' })}{' '}
                    {pngToClaim && pngToClaim.greaterThan('0') && (
                      <StyledInternalLink
                        onClick={() => setShowPngBalanceModal(false)}
                        to={`/png/${STAKING_REWARDS_CURRENT_VERSION}`}>
                        ({t('earn.claim')})
                      </StyledInternalLink>
                    )}
                  </TYPE.white>
                </RowBetween>
              </AutoColumn>
            </CardSection>
            <Break />
          </>
        )}
        <CardSection gap="sm">
          <AutoColumn gap="md">
            <RowBetween>
              <TYPE.white color="white">{t('header.pngPrice')}</TYPE.white>
              <TYPE.white color="white">{pngPrice?.toFixed(5) ?? '-'} AVAX</TYPE.white>
            </RowBetween>
            <RowBetween>
              <TYPE.white color="white">{t('header.pngCirculation')}</TYPE.white>
              <TYPE.white color="white">{circulation?.toFixed(0, { groupSeparator: ',' })}</TYPE.white>
            </RowBetween>
            <RowBetween>
              <TYPE.white color="white">{t('header.totalSupply')}</TYPE.white>
              <TYPE.white color="white">{totalSupply?.toFixed(0, { groupSeparator: ',' })}</TYPE.white>
            </RowBetween>
          </AutoColumn>
        </CardSection>
        {account && (
          <>
          <CardSection gap="sm">
            <AutoColumn gap="md">
              <AddPNG onClick={() => {
                injected.getProvider().then(provider => {
                  if (provider) {
                    provider.request({
                      method: 'wallet_watchAsset',
                      params: {
                        type: 'ERC20',
                        options: {
                          address: png?.address,
                          symbol: png?.symbol,
                          decimals: png?.decimals,
                          image: 'https://raw.githubusercontent.com/pangolindex/tokens/main/assets/0x60781C2586D68229fde47564546784ab3fACA982/logo.png',
                        },
                      },
                    }).catch((error: any) => {
                      console.error(error)
                    })
                  }
                });
              }
            }>
                <TYPE.white color="white">{t('header.addmetamask')}</TYPE.white>
              </AddPNG>
            </AutoColumn>
          </CardSection>
          </>
          )
        }
      </ModalUpper>
    </ContentWrapper>
  )
}
