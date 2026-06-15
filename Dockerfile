# Usa uma versão leve e moderna do Node.js
FROM node:18-alpine

# Cria o diretório de trabalho dentro do container
WORKDIR /app

# Copia os arquivos de configuração de dependências
COPY package*.json ./

# Instala apenas as dependências necessárias
RUN npm install

# Copia o restante dos arquivos do seu bot
COPY . .

# Comando padrão que o Fly vai usar para ligar o seu bot
CMD [ "node", "index.js" ]
