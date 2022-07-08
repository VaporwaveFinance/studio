import { Inject } from '@nestjs/common';
import { compact } from "lodash";
import Axios from 'axios';

import { IAppToolkit, APP_TOOLKIT } from '~app-toolkit/app-toolkit.interface';
import { Register } from '~app-toolkit/decorators';
import { PositionFetcher } from '~position/position-fetcher.interface';
import { AppTokenPosition, Token } from '~position/position.interface';
import { Network } from '~types/network.interface';
import { ContractType } from '~position/contract.interface';

import { VaporwaveFinanceContractFactory } from '../contracts';
import { VAPORWAVE_FINANCE_DEFINITION } from '../vaporwave-finance.definition';
import { buildDollarDisplayItem } from "~app-toolkit/helpers/presentation/display-item.present";
import { BaseToken } from '~position/token.interface';
import { CacheOnInterval } from "~cache/cache-on-interval.decorator";
import TRISOLARIS_DEFINITION from '~apps/trisolaris/trisolaris.definition';
import { DefaultDataProps, WithMetaType } from '~position/display.interface';
import e from 'express';


const appId = VAPORWAVE_FINANCE_DEFINITION.id;
const groupId = VAPORWAVE_FINANCE_DEFINITION.groups.vault.id;
const network = Network.AURORA_MAINNET;


export type VaporwaveVaultDetails = {
  id: string
  name: string // label
  earnContractAddress: string // vault address
  earnedToken: string // vault token

  oracleId: string // NOT a proper symbol
  tokenAddress: string // want
  tokenDecimals: number // decimal

  pricePerFullShare: number // ratio

  logo: string
  status: string // check for retired
  assets: string[]
};


export async function getRegisteredToken(
  tokenAddress: string,
  symbol: string,
  registeredTokens: (BaseToken | AppTokenPosition<DefaultDataProps>)[],
) {
  let wantToken: BaseToken | AppTokenPosition<DefaultDataProps> | undefined = undefined

  if (tokenAddress) {
    const underlyingTokenAddress = tokenAddress.toLowerCase();
    wantToken = registeredTokens.find(p => p.address === underlyingTokenAddress);
  } else {
    const tokenSymbol = symbol
    wantToken = registeredTokens.find(p => p.symbol === tokenSymbol);
  }

  if (!wantToken) {
    return null;
  } else {
    return wantToken;
  }

}

@Register.TokenPositionFetcher({ appId, groupId, network })
export class AuroraVaporwaveFinanceVaultTokenFetcher implements PositionFetcher<AppTokenPosition> {
  constructor(
    @Inject(APP_TOOLKIT) private readonly appToolkit: IAppToolkit,
    @Inject(VaporwaveFinanceContractFactory)
    private readonly vaporwaveFinanceContractFactory: VaporwaveFinanceContractFactory,
  ) { }


  @CacheOnInterval({
    key: `apps-v3:${network}:${appId}:${groupId}:want_prices`,
    timeout: 15 * 60 * 1000,
  })
  async getWantPrices() {
    const wantPrices = await Axios.get("https://api.vaporwave.farm/lps").then(
      (v) => v.data
    )
    return wantPrices
  }

  @CacheOnInterval({
    key: `apps-v3:${network}:${appId}:${groupId}:base_token`,
    timeout: 15 * 60 * 1000,
  })
  async getBaseTokenPrices() {
    const baseTokenPrices = await Axios.get("https://api.vaporwave.farm/prices").then(
      (v) => v.data
    )
    return baseTokenPrices
  }

  @CacheOnInterval({
    key: `apps-v3:${network}:${appId}:${groupId}:vaults`,
    timeout: 15 * 60 * 1000,
  })
  async getVaults() {
    const vaultData = await Axios.get<VaporwaveVaultDetails[]>("https://api.vaporwave.farm/vaults").then(
      (v) => v.data
    )
    return vaultData
  }

  @CacheOnInterval({
    key: `apps-v3:${network}:${appId}:${groupId}:vaportokenprices`,
    timeout: 15 * 60 * 1000,
  })
  async getVTokenPrices() {
    const vtokenPrices = await Axios.get("https://api.vaporwave.farm/vaportokenprices").then(
      (v) => v.data
    )
    return vtokenPrices
  }

  @CacheOnInterval({
    key: `apps-v3:${network}:${appId}:${groupId}:apy`,
    timeout: 15 * 60 * 1000,
  })
  async getAPY() {
    const apy = await Axios.get("https://api.vaporwave.farm/apy").then(
      (v) => v.data
    )
    return apy
  }

  async getPositions() {
    // http://localhost:5001/apps/vaporwave-finance/tokens?groupIds[]=vault&network=aurora
    const vaultData = await this.getVaults()
    const vtokenPrices = await this.getVTokenPrices()
    const apyData = await this.getAPY()
    const wantPrices = await this.getWantPrices()
    const baseTokenPrices = await this.getBaseTokenPrices()
    const multicall = this.appToolkit.getMulticall(network)

    const baseTokens = await this.appToolkit.getBaseTokenPrices(network);
    const appTokens = await this.appToolkit.getAppTokenPositions({ appId: TRISOLARIS_DEFINITION.id, groupIds: [TRISOLARIS_DEFINITION.groups.pool.id], network });
    const allTokens = [...appTokens, ...baseTokens];


    const tokens = await Promise.all(
      vaultData.map(async (vault) => {
        if (vault.status != "active") {
          return null
        }

        const vaultAddress = vault.earnContractAddress
        const contract = this.vaporwaveFinanceContractFactory.vault({
          address: vaultAddress,
          network,
        });

        // Request the symbol, decimals, ands supply for the jar token
        const [symbol, decimals, supplyRaw, balanceOfWant] = await Promise.all([
          multicall.wrap(contract).symbol(),
          multicall.wrap(contract).decimals(),
          multicall.wrap(contract).totalSupply(),
          multicall.wrap(contract).balance(),
        ]);

        // Denormalize the supply
        const supply = Number(supplyRaw) / 10 ** decimals;
        let wantToken = await getRegisteredToken(vault.tokenAddress, vault.oracleId, allTokens)
        if (!wantToken) return;
        let tokens = [wantToken]

        // Denormalize the price per share
        const pricePerShare = Number(vault.pricePerFullShare) / 10 ** 18;
        const price = vtokenPrices[vault.earnedToken]

        // The Liquidity is the deposited reserve times the price of the deposited token
        const reserve = Number(balanceOfWant) / 10 ** vault.tokenDecimals
        const liquidity = reserve * tokens[0].price;

        // As a label, we'll use the underlying label (i.e.: 'LOOKS' or 'UNI-V2 LOOKS / ETH'), and suffix it with 'Jar'
        const label = vault.name;
        // For the secondary label, we'll use the price of the vault token
        const secondaryLabel = buildDollarDisplayItem(price);
        // And for a tertiary label, we'll use the APY
        const tertiaryLabel = `${(apyData[vault.id] * 100).toFixed(3)}% APY`;
        const images: string[] = []
        if (vault.logo) {
          images.push(`https://raw.githubusercontent.com/VaporwaveFinance/vwave-app-pub/main/src/${vault.logo}`)
        } else {
          vault.assets.forEach(
            (asset) => images.push(`https://raw.githubusercontent.com/VaporwaveFinance/vwave-app-pub/main/src/single-assets/${asset}.png`)
          )
        }
        const token: AppTokenPosition = {
          type: ContractType.APP_TOKEN,
          appId,
          groupId,
          address: vaultAddress,
          network,
          symbol,
          decimals,
          supply,
          pricePerShare,
          price,
          tokens: tokens,
          dataProps: {
            apy: apyData[vault.id],
            liquidity: liquidity,
          },
          displayProps: {
            label: label,
            images: images,
            secondaryLabel: secondaryLabel,
            tertiaryLabel: tertiaryLabel,
          },
        };

        return token

      })
    )

    return compact(tokens)
  }
}
