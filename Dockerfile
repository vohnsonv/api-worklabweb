# Image base oficial com Playwright e Chromium pré-instalados
FROM mcr.microsoft.com/playwright:v1.50.0-noble

# Diretório de trabalho no container
WORKDIR /app

# Copiar manifesto de dependências
COPY package.json ./

# Instalar dependências de produção e tipos
RUN npm install

# Copiar todo o código-fonte da aplicação
COPY . .

# Compilar código TypeScript para JavaScript (/dist)
RUN npm run build

# Criar pasta de dados persistentes
RUN mkdir -p /app/data

# Expor a porta da API REST e Dashboard
EXPOSE 3000

# Definir variável de ambiente de produção
ENV NODE_ENV=production

# Comando de inicialização 24/7
CMD ["npm", "start"]
