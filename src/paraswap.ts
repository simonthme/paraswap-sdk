import axios, { AxiosError } from 'axios';
import * as async from 'async';
import * as qs from 'qs';
import * as _ from 'lodash';
import Web3 from 'web3';

import {
  Adapters,
  Address,
  AddressOrSymbol,
  Allowance,
  APIError,
  BuildOptions,
  ETHER_ADDRESS,
  NetworkID,
  PriceString,
  RateOptions,
  Transaction,
  OptimalRatesWithPartnerFees,
} from './types';

import ERC20_ABI = require('./abi/erc20.json');

import AUGUSTUS_ABI = require('./abi/augustus.json');

import { Token } from './lib/token';
import { NULL_ADDRESS, TransactionBuilder } from './lib/transaction-builder';
import { SwapSide } from './constants';

const API_URL = 'https://api.paraswap.io/v2';

export class ParaSwap {
  adapters?: Adapters;
  tokens: Token[] = [];

  constructor(
    private network: NetworkID = 1,
    private apiURL: string = API_URL,
    public web3Provider?: any,
  ) {
    if (web3Provider && !web3Provider.eth) {
      this.web3Provider = new Web3(web3Provider);
    }
  }

  setWeb3Provider(web3Provider: any) {
    if (!web3Provider.eth) {
      this.web3Provider = new Web3(web3Provider);
    } else {
      this.web3Provider = web3Provider;
    }
    return this;
  }

  private handleAPIError(e: AxiosError): APIError {
    if (e.response) {
      const { data, status } = e.response!;
      return { status, message: data.error };
    }
    return new Error(e.message);
  }

  async getTokens() {
    try {
      const tokensURL = `${this.apiURL}/tokens/${this.network}`;
      const { data } = await axios.get(tokensURL);
      this.tokens = (data.tokens as Token[]).map(
        t =>
          new Token(
            t.address,
            t.decimals,
            t.symbol,
            t.tokenType,
            t.mainConnector,
            t.connectors,
            t.network,
            t.img,
          ),
      );
      return this.tokens;
    } catch (e) {
      return this.handleAPIError(e);
    }
  }

  async getAdapters() {
    try {
      const { data } = await axios.get(
        `${this.apiURL}/adapters/${this.network}`,
      );

      this.adapters = data;

      return this.adapters;
    } catch (e) {
      return this.handleAPIError(e);
    }
  }

  private checkDexList(dexs?: string) {
    if (dexs) {
      const targetDEXs = dexs.split(',');

      if (!targetDEXs.length) {
        throw new Error('Invalid DEX list');
      }
    }
  }

  async getRateByRoute(
    route: AddressOrSymbol[],
    amount: PriceString,
    side: SwapSide,
    options?: RateOptions,
  ): Promise<OptimalRatesWithPartnerFees | APIError> {
    try {
      const { excludeDEXS, includeDEXS, includeMPDEXS, excludeMPDEXS } =
        options || {};

      this.checkDexList(includeDEXS);
      this.checkDexList(excludeDEXS);
      this.checkDexList(includeMPDEXS);
      this.checkDexList(excludeMPDEXS);

      if (route.length < 2) {
        return { message: 'Invalid Route' };
      }

      const query = _.isEmpty(options)
        ? ''
        : qs.stringify({
            excludeDEXS,
            includeDEXS,
            includeMPDEXS,
            excludeMPDEXS,
          });

      const pricesURL = `${this.apiURL}/prices/?route=${route.join(
        '-',
      )}&amount=${amount}&${query}&side=${side}`;

      const { data } = await axios.get(pricesURL);

      return data.priceRoute;
    } catch (e) {
      return this.handleAPIError(e);
    }
  }

  async getRate(
    srcToken: AddressOrSymbol,
    destToken: AddressOrSymbol,
    amount: PriceString,
    side: SwapSide = SwapSide.SELL,
    options?: RateOptions,
  ): Promise<OptimalRatesWithPartnerFees | APIError> {
    try {
      const { excludeDEXS, includeDEXS } = options || {};

      this.checkDexList(includeDEXS);
      this.checkDexList(excludeDEXS);

      const query = _.isEmpty(options)
        ? ''
        : qs.stringify({ excludeDEXS, includeDEXS });

      const pricesURL = `${
        this.apiURL
      }/prices/?from=${srcToken}&to=${destToken}&amount=${amount}${
        query ? '&' + query : ''
      }&side=${side}`;
      const { data } = await axios.get(pricesURL);
      return data.priceRoute;
    } catch (e) {
      return this.handleAPIError(e);
    }
  }

  async buildTx(
    srcToken: Address,
    destToken: Address,
    srcAmount: PriceString,
    destAmount: PriceString,
    priceRoute: OptimalRatesWithPartnerFees,
    userAddress: Address,
    referrer: string,
    receiver?: Address,
    options: BuildOptions = {},
  ) {
    try {
      const query = _.isEmpty(options) ? '' : qs.stringify(options);

      const txURL = `${this.apiURL}/transactions/${this.network}/?${query}`;

      const txConfig = {
        priceRoute,
        srcToken,
        destToken,
        srcAmount,
        destAmount,
        userAddress,
        referrer,
        receiver: receiver || '',
      };

      const { data } = await axios.post(txURL, txConfig);

      return data as Transaction;
    } catch (e) {
      return this.handleAPIError(e);
    }
  }

  //Warning: ParaSwapPool is not supported when building locally
  async buildTxLocally(
    srcToken: Token,
    destToken: Token,
    srcAmount: string,
    minMaxAmount: string,
    priceRoute: OptimalRatesWithPartnerFees,
    userAddress: string,
    referrer: string,
    gasPrice: string,
    receiver: string = NULL_ADDRESS,
    donatePercent: string = '0',
    options: BuildOptions = {},
  ) {
    if (!this.adapters) {
      await this.getAdapters();
    }

    if (!this.tokens.length) {
      await this.getTokens();
    }

    const transaction = new TransactionBuilder(
      this.network,
      this.web3Provider!,
      this.adapters!,
      this.tokens,
    );

    if (options.onlyParams) {
      if (priceRoute.side === SwapSide.SELL) {
        return transaction.getTransactionSellParams(
          srcToken,
          destToken,
          srcAmount,
          minMaxAmount,
          priceRoute,
          userAddress,
          referrer,
          gasPrice,
          receiver,
          donatePercent,
        );
      } else {
        return transaction.getTransactionBuyParams(
          srcToken,
          destToken,
          srcAmount,
          minMaxAmount,
          priceRoute,
          userAddress,
          referrer,
          gasPrice,
          receiver,
          donatePercent,
        );
      }
    }

    return transaction.buildTransaction(
      srcToken,
      destToken,
      srcAmount,
      minMaxAmount,
      priceRoute,
      userAddress,
      referrer,
      gasPrice,
      receiver,
      donatePercent,
      !!options.ignoreChecks,
    );
  }

  async getSpender(_provider?: any): Promise<Address | APIError> {
    if (!this.adapters) {
      const adaptersOrError = await this.getAdapters();

      if ((adaptersOrError as APIError).message) {
        return adaptersOrError as APIError;
      }

      this.adapters = adaptersOrError as Adapters;
    }

    const provider = this.web3Provider || _provider;

    const augustusAddress = this.adapters.augustus.exchange;

    const augustusContract = new provider.eth.Contract(
      AUGUSTUS_ABI,
      augustusAddress,
    );

    return augustusContract.methods.getTokenTransferProxy().call();
  }

  async getAllowances(
    userAddress: Address,
    tokenAddresses: Address[],
  ): Promise<Allowance[] | APIError> {
    try {
      const balancesOrError = await this.getBalances(userAddress);

      if ((<APIError>balancesOrError).message) {
        return <APIError>balancesOrError;
      }

      return (<Token[]>balancesOrError)
        .filter(t =>
          tokenAddresses.find(
            addr => addr.toLowerCase() === t.address.toLowerCase(),
          ),
        )
        .map(token => ({
          tokenAddress: token.address,
          allowance: token.allowance || '0',
        }));
    } catch (e) {
      return { message: e.message };
    }
  }

  async getAllowance(
    userAddress: Address,
    tokenAddress: Address,
  ): Promise<Allowance | APIError> {
    try {
      const allowanceOrError = await this.getAllowances(userAddress, [
        tokenAddress,
      ]);

      if ((<APIError>allowanceOrError).message) {
        return <APIError>allowanceOrError;
      }

      const allowances = allowanceOrError as Allowance[];

      if (!allowances.length) {
        return { message: 'Not Found' };
      }

      return allowances[0];
    } catch (e) {
      return { message: e.message };
    }
  }

  async approveTokenBulk(
    amount: PriceString,
    userAddress: Address,
    tokenAddresses: Address[],
    _provider?: any,
  ): Promise<string[]> {
    return await Promise.all(
      tokenAddresses.map(tokenAddress =>
        this.approveToken(amount, userAddress, tokenAddress, _provider),
      ),
    );
  }

  async approveToken(
    amount: PriceString,
    userAddress: Address,
    tokenAddress: Address,
    _provider?: any,
  ): Promise<string> {
    return new Promise(async (resolve, reject) => {
      const spender = await this.getSpender();

      const provider = _provider || this.web3Provider;

      const contract: any = new provider!.eth.Contract(ERC20_ABI, tokenAddress);

      return contract.methods
        .approve(spender, amount)
        .send({ from: userAddress }, (err: any, txHash: string) => {
          if (err) return reject(err.message);
          resolve(txHash);
        });
    });
  }

  async getMarketNames(): Promise<string[] | APIError> {
    try {
      const { data } = await axios.get(
        `${this.apiURL}/adapters/list?namesOnly=true`,
      );

      return data;
    } catch (e) {
      return this.handleAPIError(e);
    }
  }

  async getBalance(
    userAddress: Address,
    token: AddressOrSymbol,
  ): Promise<Token | APIError> {
    return new Promise(async (resolve, reject) => {
      try {
        const tokensURL = `${this.apiURL}/users/tokens/${this.network}/${userAddress}/${token}`;

        const { data } = await axios.get(tokensURL);

        resolve(data.token);
      } catch (e) {
        reject({ error: e.message });
      }
    });
  }

  async getBalances(userAddress: Address): Promise<Token[] | APIError> {
    return new Promise(async (resolve, reject) => {
      try {
        const tokensURL = `${this.apiURL}/users/tokens/${this.network}/${userAddress}`;

        const { data } = await axios.get(tokensURL);
        const tokens = (data.tokens as Token[]).map(t => {
          let token = new Token(t.address, t.decimals, t.symbol);
          token.balance = t.balance;
          token.allowance = t.allowance;
          return token;
        });

        resolve(tokens);
      } catch (e) {
        reject({ error: e.message });
      }
    });
  }
}
